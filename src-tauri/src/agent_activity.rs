use crate::db::{data_dir, log_activity, DbState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

const OBSERVER_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
];

const OBSERVER_MARKER: &str = "skilldeck-agent-observer";
const MAX_ACTIVITY_TEXT: usize = 240;
const ACTIVITY_JOURNAL_LIMIT: usize = 500;
const MAX_ACTIVITY_JOURNAL_BYTES: u64 = 5 * 1024 * 1024;
const MAX_RETAINED_ACTIVITY_EVENTS: usize = 5000;
const ACTIVITY_READ_TAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityEvent {
    pub id: String,
    pub agent: String,
    pub session_id: String,
    pub event: String,
    pub state: String,
    pub project: String,
    pub task_id: Option<String>,
    pub task_title: Option<String>,
    pub task_status: Option<String>,
    pub task_progress: Option<f64>,
    pub step: Option<String>,
    pub tool_name: Option<String>,
    pub activity: Option<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub project_path: String,
    pub project_name: String,
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub progress: Option<f64>,
    pub step: Option<String>,
    pub updated_at: i64,
    pub active_agent: Option<String>,
    pub last_event: Option<String>,
    pub last_tool: Option<String>,
    pub last_activity: Option<String>,
    pub last_activity_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivitySnapshot {
    pub events: Vec<AgentActivityEvent>,
    pub tasks: Vec<TaskProgress>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookObserverStatus {
    pub agent: String,
    pub installed: bool,
    pub config_exists: bool,
    pub config_path: String,
}

pub fn activity_journal_path() -> PathBuf {
    data_dir().join("agent-events.jsonl")
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

fn value_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_owned))
}

fn first_string(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

fn truncate_text(value: String) -> String {
    value
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_ACTIVITY_TEXT)
        .collect()
}

fn normalize_timestamp(value: &Value) -> i64 {
    let timestamp = value
        .get("timestamp")
        .and_then(Value::as_i64)
        .unwrap_or_else(now_seconds);
    if timestamp > 9_999_999_999 {
        timestamp / 1_000
    } else {
        timestamp
    }
}

fn event_state(event: &str) -> &'static str {
    match event {
        "PermissionRequest" => "waiting",
        "PostToolUseFailure" | "StopFailure" => "failed",
        "Stop" | "SubagentStop" | "TeammateIdle" => "done",
        _ => "working",
    }
}

fn project_from_payload(value: &Value) -> String {
    let workspace_root = value
        .get("workspace_roots")
        .and_then(Value::as_array)
        .and_then(|roots| {
            roots
                .iter()
                .find_map(|root| root.as_str().filter(|item| !item.is_empty()))
        })
        .map(str::to_owned);
    first_string(&[
        value_string(value, &["cwd", "project", "project_path", "projectPath"]).unwrap_or_default(),
        workspace_root.unwrap_or_default(),
        std::env::current_dir()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
    ])
}

fn project_root_for_path(path: &str) -> String {
    let original = PathBuf::from(path);
    let mut current = if original.is_dir() {
        original.clone()
    } else {
        original
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(original.clone())
    };
    loop {
        if current.join(".git").exists() {
            return fs::canonicalize(&current)
                .unwrap_or(current)
                .to_string_lossy()
                .into_owned();
        }
        if !current.pop() {
            return path.to_owned();
        }
    }
}

fn task_from_text(text: &str) -> Option<String> {
    let normalized = text.replace('\\', "/");
    for token in normalized.split_whitespace() {
        let mut parts = token.split('/');
        while let Some(part) = parts.next() {
            if part == "tasks" {
                if let Some(task_id) = parts.next().filter(|id| !id.is_empty()) {
                    return Some(task_id.to_owned());
                }
            }
        }
    }
    None
}

fn looks_like_task_id(value: &str) -> bool {
    !value.trim().is_empty()
}

fn looks_like_inferred_task_id(value: &str) -> bool {
    let mut parts = value.splitn(2, '-');
    let prefix = parts.next().unwrap_or_default();
    let suffix = parts.next().unwrap_or_default();
    prefix.len() == 2
        && prefix.chars().all(|character| character.is_ascii_digit())
        && !suffix.is_empty()
}

fn task_argument_from_command(command: &str) -> Option<String> {
    let tokens: Vec<&str> = command.split_whitespace().collect();
    tokens
        .iter()
        .position(|token| {
            let token = token.trim_matches(|character: char| "'\"()[]{}<>,;".contains(character));
            token == "task.py" || token.ends_with("/task.py")
        })
        .and_then(|position| {
            tokens[position + 1..]
                .iter()
                .map(|token| {
                    token.trim_matches(|character: char| "'\"()[]{}<>,;".contains(character))
                })
                .find(|token| looks_like_inferred_task_id(token))
                .map(str::to_owned)
        })
}

fn normalize_task_id(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        task_from_text(value).or_else(|| looks_like_task_id(value).then(|| value.to_owned()))
    }
}

fn tool_input_text(value: &Value) -> (String, String) {
    let Some(input) = value.get("tool_input").or_else(|| value.get("toolInput")) else {
        return (String::new(), String::new());
    };
    if let Some(text) = input.as_str() {
        return (text.to_owned(), text.to_owned());
    }
    let command =
        value_string(input, &["command", "cmd", "script", "description"]).unwrap_or_default();
    let file_path = value_string(
        input,
        &[
            "file_path",
            "filePath",
            "path",
            "pattern",
            "query",
            "url",
            "prompt",
        ],
    )
    .unwrap_or_default();
    let activity = first_string(&[command.clone(), file_path.clone()]);
    (command, activity)
}

fn task_payload(value: &Value) -> Value {
    value
        .get("task")
        .or_else(|| value.get("current_task"))
        .or_else(|| {
            value
                .get("tool_input")
                .or_else(|| value.get("toolInput"))
                .and_then(|input| input.get("task"))
        })
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()))
}

fn task_string(value: &Value, task: &Value, keys: &[&str]) -> Option<String> {
    value_string(task, keys).or_else(|| value_string(value, keys))
}

fn number_from_value(value: &Value) -> Option<f64> {
    if let Some(number) = value.as_f64() {
        return Some(number);
    }
    value
        .as_str()
        .and_then(|text| text.trim().trim_end_matches('%').parse::<f64>().ok())
}

fn task_progress_from_payload(value: &Value, task: &Value) -> Option<f64> {
    let raw = [
        "progress",
        "task_progress",
        "taskProgress",
        "percent",
        "percent_complete",
    ]
    .iter()
    .find_map(|key| task.get(*key).or_else(|| value.get(*key)))?;
    let number = number_from_value(raw)?;
    if number < 0.0 {
        Some(0.0)
    } else if number <= 1.0 {
        Some(number)
    } else {
        Some((number / 100.0).min(1.0))
    }
}

fn activity_from_payload(
    value: &Value,
    tool_name: Option<&str>,
    input_activity: &str,
    step: Option<&str>,
) -> Option<String> {
    let text = first_string(&[
        value_string(value, &["prompt", "message", "input"]).unwrap_or_default(),
        input_activity.to_owned(),
        step.map(str::to_owned).unwrap_or_default(),
        tool_name.map(str::to_owned).unwrap_or_default(),
    ]);
    (!text.is_empty()).then(|| truncate_text(text))
}

pub fn parse_hook_payload(
    payload: &str,
    agent_override: Option<&str>,
) -> Result<AgentActivityEvent, String> {
    let value: Value =
        serde_json::from_str(payload).map_err(|error| format!("invalid hook JSON: {error}"))?;
    if !value.is_object() {
        return Err("hook payload must be a JSON object".into());
    }
    let project = project_root_for_path(&project_from_payload(&value));
    let task = task_payload(&value);
    let (command, input_activity) = tool_input_text(&value);
    let tool_name = value_string(&value, &["tool_name", "toolName", "tool"]);
    let event = value_string(
        &value,
        &["hook_event_name", "hookEventName", "event_name", "event"],
    )
    .unwrap_or_else(|| "SessionStart".into());
    let session_id = value_string(&value, &["session_id", "sessionId", "session"])
        .unwrap_or_else(|| "unknown-session".into());
    let task_id = task_string(
        &value,
        &task,
        &["id", "task_id", "taskId", "current_task", "currentTask"],
    )
    .and_then(normalize_task_id)
    .or_else(|| task_from_text(&command))
    .or_else(|| task_argument_from_command(&command))
    .or_else(|| task_from_text(&input_activity));
    let task_title = task_string(&value, &task, &["task_title", "taskTitle", "title", "name"])
        .map(|title| truncate_text(title));
    let task_status = task_string(
        &value,
        &task,
        &[
            "status",
            "task_status",
            "taskStatus",
            "current_status",
            "currentStatus",
        ],
    );
    let task_progress = task_progress_from_payload(&value, &task);
    let step = task_string(
        &value,
        &task,
        &["step", "current_step", "currentStep", "stage"],
    )
    .map(|step| truncate_text(step));
    let agent = agent_override
        .map(str::to_owned)
        .or_else(|| value_string(&value, &["agent", "agent_kind", "agentKind"]))
        .unwrap_or_else(|| "unknown".into());
    let state = event_state(&event).to_owned();
    let activity = activity_from_payload(
        &value,
        tool_name.as_deref(),
        &input_activity,
        step.as_deref(),
    );

    Ok(AgentActivityEvent {
        id: Uuid::new_v4().to_string(),
        agent,
        session_id: session_id.clone(),
        event,
        state,
        project,
        task_id,
        task_title,
        task_status,
        task_progress,
        step,
        tool_name,
        activity,
        timestamp: normalize_timestamp(&value),
    })
}

pub fn append_activity_event(event: &AgentActivityEvent, journal: &Path) -> Result<(), String> {
    append_activity_event_with_limits(
        event,
        journal,
        MAX_ACTIVITY_JOURNAL_BYTES,
        MAX_RETAINED_ACTIVITY_EVENTS,
    )
}

fn append_activity_event_with_limits(
    event: &AgentActivityEvent,
    journal: &Path,
    max_journal_bytes: u64,
    retained_events: usize,
) -> Result<(), String> {
    if let Some(parent) = journal.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut line = serde_json::to_string(event).map_err(|error| error.to_string())?;
    line.push('\n');
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(journal)
        .map_err(|error| error.to_string())?;
    use std::io::Write;
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())?;
    if let Ok(metadata) = file.metadata() {
        if metadata.len() > max_journal_bytes {
            compact_activity_journal(journal, retained_events)?;
        }
    }
    Ok(())
}

/// 保留最近 N 条并原子重写日志。观察 Hook 可能多进程并发写入，
/// 压缩瞬间新事件有小概率丢失；该日志仅用于展示，可接受 best-effort。
fn compact_activity_journal(journal: &Path, retained_events: usize) -> Result<(), String> {
    let content = fs::read_to_string(journal).map_err(|error| error.to_string())?;
    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(retained_events);
    let mut data = lines[start..].join("\n");
    data.push('\n');
    let temp = journal.with_extension("compact.tmp");
    fs::write(&temp, data).map_err(|error| error.to_string())?;
    fs::rename(&temp, journal).map_err(|error| error.to_string())
}

pub fn load_activity_events(journal: &Path, limit: usize) -> Vec<AgentActivityEvent> {
    let Some(content) = read_journal_tail(journal, ACTIVITY_READ_TAIL_BYTES) else {
        return Vec::new();
    };
    let mut events = content
        .lines()
        .filter_map(|line| serde_json::from_str::<AgentActivityEvent>(line).ok())
        .collect::<Vec<_>>();
    let start = events.len().saturating_sub(limit);
    events.drain(..start);
    events.reverse();
    events
}

/// 只从文件尾部读取固定窗口，避免日志增长后每次轮询都全量读取。
/// 从行中间开始的首个片段无法通过 JSON 解析，会被调用方的过滤自然丢弃。
fn read_journal_tail(journal: &Path, max_bytes: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(journal).ok()?;
    let length = file.metadata().ok()?.len();
    if length == 0 {
        return Some(String::new());
    }
    let take = length.min(max_bytes);
    file.seek(SeekFrom::Start(length - take)).ok()?;
    let mut bytes = Vec::with_capacity(take as usize);
    file.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn run_hook_cli() {
    let arguments: Vec<String> = std::env::args().skip(2).collect();
    let agent_override = arguments
        .windows(2)
        .find(|pair| pair[0] == "--agent")
        .map(|pair| pair[1].clone());
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let payload = if input.trim().is_empty() {
        "{}"
    } else {
        input.as_str()
    };
    match parse_hook_payload(payload, agent_override.as_deref())
        .and_then(|event| append_activity_event(&event, &activity_journal_path()))
    {
        Ok(()) => {}
        Err(error) => eprintln!("[skilldeck hook] {error}"),
    }
}

fn load_json(path: &Path) -> Result<(Value, bool), String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(|value| (value, true))
            .map_err(|error| format!("invalid JSON in {}: {error}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok((Value::Object(Map::new()), false))
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, data).map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())
}

fn is_owned_command(command: &str) -> bool {
    command.contains(OBSERVER_MARKER) && command.contains(" hook --agent ")
}

fn contains_owned(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            object
                .get("command")
                .and_then(Value::as_str)
                .map(is_owned_command)
                .unwrap_or(false)
                || object.values().any(contains_owned)
        }
        Value::Array(items) => items.iter().any(contains_owned),
        _ => false,
    }
}

fn remove_owned(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for item in object.values_mut() {
                remove_owned(item);
            }
            object.retain(|_, item| {
                let owned = item
                    .get("command")
                    .and_then(Value::as_str)
                    .map(is_owned_command)
                    .unwrap_or(false);
                let empty_group = item
                    .get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|hooks: &Vec<Value>| hooks.is_empty());
                !item.is_null() && !owned && !empty_group
            });
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                remove_owned(item);
            }
            items.retain(|item| {
                let owned = item
                    .get("command")
                    .and_then(Value::as_str)
                    .map(is_owned_command)
                    .unwrap_or(false);
                let empty_group = item
                    .get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|hooks: &Vec<Value>| hooks.is_empty());
                !item.is_null() && !owned && !empty_group
            });
        }
        _ => {}
    }
}

fn merge_nested_hooks(config: &mut Value, command: &str, uninstall: bool) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| "hook config root must be a JSON object".to_string())?;
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| "hooks must be a JSON object".to_string())?;

    if uninstall {
        for value in hooks.values_mut() {
            remove_owned(value);
        }
        hooks.retain(|_, value| value.as_array().is_none_or(|entries| !entries.is_empty()));
        return Ok(());
    }

    for event in OBSERVER_EVENTS {
        let entries = hooks
            .entry((*event).to_string())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| format!("hooks.{event} must be an array"))?;
        let already_installed = entries.iter().any(contains_owned);
        if already_installed {
            continue;
        }
        if let Some(entry) = entries
            .iter_mut()
            .find(|entry| entry.get("hooks").and_then(Value::as_array).is_some())
        {
            entry
                .get_mut("hooks")
                .and_then(Value::as_array_mut)
                .expect("checked hooks array")
                .push(json!({ "type": "command", "command": command }));
            continue;
        }
        entries.push(json!({
            "matcher": "*",
            "hooks": [{ "type": "command", "command": command }]
        }));
    }
    Ok(())
}

fn observer_config_path(agent: &str, home: &Path) -> Result<PathBuf, String> {
    match agent {
        "claude" => Ok(home.join(".claude").join("settings.json")),
        "codex" => Ok(home.join(".codex").join("hooks.json")),
        _ => Err("agent must be claude or codex".into()),
    }
}

fn observer_command(executable: &Path, agent: &str) -> String {
    format!(
        "\"{}\" hook --agent {} --marker {}",
        executable.to_string_lossy(),
        agent,
        OBSERVER_MARKER
    )
}

pub fn enable_codex_hooks_feature(raw: &str) -> Result<String, String> {
    let parsed: toml::Value = toml::from_str(raw).map_err(|error| error.to_string())?;
    if parsed
        .get("features")
        .and_then(|features| features.get("hooks"))
        .and_then(toml::Value::as_bool)
        == Some(true)
    {
        return Ok(raw.to_owned());
    }

    let mut lines: Vec<String> = raw.lines().map(str::to_owned).collect();
    let mut in_features = false;
    let mut inserted = false;
    for line in &mut lines {
        let trimmed = line.trim();
        if trimmed.starts_with("[features") {
            in_features = true;
            continue;
        }
        if in_features && trimmed.starts_with("hooks") {
            *line = "hooks = true".into();
            let mut output = lines.join("\n");
            if !output.ends_with('\n') {
                output.push('\n');
            }
            return Ok(output);
        }
        if in_features && trimmed.starts_with('[') {
            *line = format!("hooks = true\n{line}");
            inserted = true;
            break;
        }
    }
    if in_features && !inserted {
        lines.push("hooks = true".into());
    }
    if !in_features {
        if !lines.iter().any(|line| line.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push("[features]".into());
        lines.push("hooks = true".into());
    }
    let mut output = lines.join("\n");
    if !output.ends_with('\n') {
        output.push('\n');
    }
    toml::from_str::<toml::Value>(&output).map_err(|error| error.to_string())?;
    Ok(output)
}

pub fn observer_status_for(agent: &str, home: &Path) -> Result<HookObserverStatus, String> {
    let path = observer_config_path(agent, home)?;
    let (config, config_exists) = load_json(&path)?;
    let feature_enabled = agent != "codex" || {
        let config_toml = home.join(".codex").join("config.toml");
        let raw = fs::read_to_string(config_toml).unwrap_or_default();
        toml::from_str::<toml::Value>(&raw)
            .map(|value| {
                value
                    .get("features")
                    .and_then(|features| features.get("hooks"))
                    .and_then(toml::Value::as_bool)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    };
    Ok(HookObserverStatus {
        agent: agent.to_owned(),
        installed: config_exists && feature_enabled && contains_owned(&config),
        config_exists,
        config_path: path.to_string_lossy().into_owned(),
    })
}

pub fn set_observer_for(
    agent: &str,
    enabled: bool,
    home: &Path,
    executable: &Path,
) -> Result<HookObserverStatus, String> {
    let path = observer_config_path(agent, home)?;
    let (mut config, config_exists) = load_json(&path)?;
    let command = observer_command(executable, agent);
    merge_nested_hooks(&mut config, &command, !enabled)?;
    if enabled || config_exists {
        write_atomic(&path, &config)?;
    }

    if agent == "codex" && enabled {
        let config_toml = home.join(".codex").join("config.toml");
        let raw = fs::read_to_string(&config_toml).unwrap_or_default();
        let updated = enable_codex_hooks_feature(&raw)?;
        if let Some(parent) = config_toml.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&config_toml, updated).map_err(|error| error.to_string())?;
    }

    observer_status_for(agent, home)
}

fn project_name(project_path: &str) -> String {
    Path::new(project_path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| project_path.to_owned())
}

pub fn activity_snapshot(mut events: Vec<AgentActivityEvent>) -> AgentActivitySnapshot {
    let mut session_tasks: HashMap<String, String> = HashMap::new();
    let mut tasks: HashMap<(String, String), TaskProgress> = HashMap::new();
    for event in events.iter_mut().rev() {
        match &event.task_id {
            Some(task_id) => {
                session_tasks.insert(event.session_id.clone(), task_id.clone());
            }
            None => {
                if let Some(task_id) = session_tasks.get(&event.session_id) {
                    event.task_id = Some(task_id.clone());
                }
            }
        }
        let Some(task_id) = event.task_id.clone() else {
            continue;
        };
        let key = (event.project.clone(), task_id.clone());
        let task = tasks.entry(key).or_insert_with(|| TaskProgress {
            project_path: event.project.clone(),
            project_name: project_name(&event.project),
            task_id,
            title: String::new(),
            status: event.state.clone(),
            progress: None,
            step: None,
            updated_at: event.timestamp,
            active_agent: None,
            last_event: None,
            last_tool: None,
            last_activity: None,
            last_activity_at: None,
        });
        if let Some(title) = &event.task_title {
            task.title = title.clone();
        }
        if let Some(status) = &event.task_status {
            task.status = status.clone();
        }
        if let Some(progress) = event.task_progress {
            task.progress = Some(progress);
        }
        if let Some(step) = &event.step {
            task.step = Some(step.clone());
        }
        task.updated_at = event.timestamp;
        task.last_event = Some(event.event.clone());
        task.last_tool = event.tool_name.clone();
        task.last_activity = event.activity.clone();
        task.last_activity_at = Some(event.timestamp);
    }

    let current_tasks = session_tasks
        .into_iter()
        .map(|(session, task_id)| {
            let event = events.iter().find(|event| {
                event.session_id == session && event.task_id.as_deref() == Some(task_id.as_str())
            });
            let project = event.map(|event| event.project.clone()).unwrap_or_default();
            let agent = event.map(|event| event.agent.clone());
            ((project, task_id), agent)
        })
        .collect::<HashMap<_, _>>();
    for task in tasks.values_mut() {
        task.active_agent = current_tasks
            .get(&(task.project_path.clone(), task.task_id.clone()))
            .cloned()
            .flatten();
        if task.title.is_empty() {
            task.title = task.task_id.clone();
        }
    }
    let mut tasks = tasks.into_values().collect::<Vec<_>>();
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    AgentActivitySnapshot { events, tasks }
}

#[tauri::command(async)]
pub fn get_hook_observer_status() -> Result<Vec<HookObserverStatus>, String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
    ["claude", "codex"]
        .into_iter()
        .map(|agent| observer_status_for(agent, &home))
        .collect()
}

#[tauri::command(async)]
pub fn set_hook_observer_enabled(
    db: State<DbState>,
    agent: String,
    enabled: bool,
) -> Result<HookObserverStatus, String> {
    let status = {
        let home = dirs::home_dir().ok_or_else(|| "home directory not found".to_string())?;
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        set_observer_for(&agent, enabled, &home, &executable)?
    };
    let conn = db.0.lock().map_err(|error| error.to_string())?;
    log_activity(
        &conn,
        "hook_observer_toggle",
        &format!("{} {}", agent, if enabled { "on" } else { "off" }),
    );
    Ok(status)
}

#[tauri::command(async)]
pub fn get_agent_activity_snapshot() -> Result<AgentActivitySnapshot, String> {
    let events = load_activity_events(&activity_journal_path(), ACTIVITY_JOURNAL_LIMIT);
    Ok(activity_snapshot(events))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("skilldeck-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn parses_agent_task_and_waiting_state() {
        let event = parse_hook_payload(
            r#"{
                "session_id":"s1",
                "cwd":"/repo/project",
                "hook_event_name":"PermissionRequest",
                "tool_name":"Bash",
                "tool_input":{"command":"python .trellis/scripts/task.py start 07-demo"}
            }"#,
            Some("claude"),
        )
        .unwrap();
        assert_eq!(event.agent, "claude");
        assert_eq!(event.state, "waiting");
        assert_eq!(event.task_id.as_deref(), Some("07-demo"));
        assert!(event.activity.unwrap().contains("task.py"));
    }

    #[test]
    fn parses_task_id_from_relative_task_path_in_shell_command() {
        let event = parse_hook_payload(
            r#"{
                "session_id":"s1",
                "cwd":"/repo/project",
                "hook_event_name":"PreToolUse",
                "tool_name":"Bash",
                "tool_input":{"command":"cat .trellis/tasks/08-live/task.json"}
            }"#,
            Some("codex"),
        )
        .unwrap();
        assert_eq!(event.task_id.as_deref(), Some("08-live"));
    }

    #[test]
    fn parses_generic_task_progress_payload() {
        let event = parse_hook_payload(
            r#"{
                "session_id":"s-generic",
                "cwd":"/repo/project",
                "hook_event_name":"PostToolUse",
                "task":{
                    "id":"login-feature",
                    "title":"登录功能",
                    "status":"in_progress",
                    "progress":65,
                    "step":"正在修复登录回调"
                },
                "tool_name":"Bash",
                "tool_input":{"command":"npm test"}
            }"#,
            Some("codex"),
        )
        .unwrap();
        assert_eq!(event.task_id.as_deref(), Some("login-feature"));
        assert_eq!(event.task_title.as_deref(), Some("登录功能"));
        assert_eq!(event.task_status.as_deref(), Some("in_progress"));
        assert_eq!(event.task_progress, Some(0.65));
        assert_eq!(event.step.as_deref(), Some("正在修复登录回调"));
        assert_eq!(event.activity.as_deref(), Some("npm test"));
    }

    #[test]
    fn journal_round_trips_latest_events_first() {
        let dir = temp_dir("journal");
        let journal = dir.join("events.jsonl");
        for second in 0..3 {
            let event = AgentActivityEvent {
                id: second.to_string(),
                agent: "codex".into(),
                session_id: "s".into(),
                event: "PreToolUse".into(),
                state: "working".into(),
                project: "/repo".into(),
                task_id: None,
                task_title: None,
                task_status: None,
                task_progress: None,
                step: None,
                tool_name: None,
                activity: None,
                timestamp: second,
            };
            append_activity_event(&event, &journal).unwrap();
        }
        let events = load_activity_events(&journal, 2);
        assert_eq!(
            events
                .iter()
                .map(|event| event.timestamp)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
    }

    fn journal_event(second: i64) -> AgentActivityEvent {
        AgentActivityEvent {
            id: second.to_string(),
            agent: "codex".into(),
            session_id: "s".into(),
            event: "PreToolUse".into(),
            state: "working".into(),
            project: "/repo".into(),
            task_id: None,
            task_title: None,
            task_status: None,
            task_progress: None,
            step: None,
            tool_name: None,
            activity: None,
            timestamp: second,
        }
    }

    #[test]
    fn journal_compacts_and_keeps_recent_events() {
        let dir = temp_dir("journal-compaction");
        let journal = dir.join("events.jsonl");
        for second in 0..12 {
            append_activity_event_with_limits(
                &journal_event(second),
                &journal,
                1,
                5,
            )
            .unwrap();
        }
        let raw = fs::read_to_string(&journal).unwrap();
        assert_eq!(raw.lines().count(), 5);
        let events = load_activity_events(&journal, ACTIVITY_JOURNAL_LIMIT);
        assert_eq!(
            events
                .iter()
                .map(|event| event.timestamp)
                .collect::<Vec<_>>(),
            vec![11, 10, 9, 8, 7]
        );
    }

    #[test]
    fn activity_reads_only_the_tail_window() {
        let dir = temp_dir("journal-tail");
        let journal = dir.join("events.jsonl");
        for second in 0..30 {
            append_activity_event(&journal_event(second), &journal).unwrap();
        }
        let one_line_len = fs::read_to_string(&journal)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .len() as u64;
        let tail_bytes = one_line_len * 4;
        let Some(content) = read_journal_tail(&journal, tail_bytes) else {
            panic!("journal must be readable");
        };
        let parsed = content
            .lines()
            .filter_map(|line| serde_json::from_str::<AgentActivityEvent>(line).ok())
            .count();
        assert!(parsed <= 4, "tail window must not parse the full journal");
        let events = load_activity_events(&journal, ACTIVITY_JOURNAL_LIMIT);
        assert_eq!(events.len(), 30);
        assert_eq!(events.first().unwrap().timestamp, 29);
    }

    #[test]
    fn observer_merge_is_idempotent_and_removes_only_owned_hooks() {
        let mut config = json!({
            "hooks": {
                "PreToolUse": [
                    {"matcher":"Bash","hooks":[{"type":"command","command":"keep-me"}]}
                ]
            }
        });
        merge_nested_hooks(
            &mut config,
            "/app hook --agent codex --marker skilldeck-agent-observer",
            false,
        )
        .unwrap();
        let installed = serde_json::to_string(&config).unwrap();
        assert_eq!(installed.matches("skilldeck-agent-observer").count(), 6);
        merge_nested_hooks(
            &mut config,
            "/app hook --agent codex --marker skilldeck-agent-observer",
            false,
        )
        .unwrap();
        assert_eq!(serde_json::to_string(&config).unwrap(), installed);
        merge_nested_hooks(
            &mut config,
            "/app hook --agent codex --marker skilldeck-agent-observer",
            true,
        )
        .unwrap();
        assert!(serde_json::to_string(&config).unwrap().contains("keep-me"));
        assert!(!serde_json::to_string(&config)
            .unwrap()
            .contains("skilldeck-agent-observer"));
    }

    #[test]
    fn codex_feature_toggle_preserves_existing_toml() {
        let updated = enable_codex_hooks_feature("[mcp_servers.foo]\ncommand = \"foo\"\n").unwrap();
        assert!(updated.contains("[mcp_servers.foo]"));
        assert!(updated.contains("[features]"));
        assert!(updated.contains("hooks = true"));

        let updated = enable_codex_hooks_feature("[features]\nhooks = false\n").unwrap();
        assert_eq!(updated, "[features]\nhooks = true\n");
    }

    #[test]
    fn generic_task_snapshot_preserves_metadata_and_binds_followup_activity() {
        let event = AgentActivityEvent {
            id: "initial".into(),
            agent: "codex".into(),
            session_id: "s".into(),
            event: "PreToolUse".into(),
            state: "working".into(),
            project: "/repo/project".into(),
            task_id: Some("login-feature".into()),
            task_title: Some("登录功能".into()),
            task_status: Some("in_progress".into()),
            task_progress: Some(0.5),
            step: Some("编写回调".into()),
            tool_name: Some("Bash".into()),
            activity: Some("npm test".into()),
            timestamp: 42,
        };
        let mut followup = event.clone();
        followup.id = "followup".into();
        followup.event = "PostToolUse".into();
        followup.task_id = None;
        followup.task_title = None;
        followup.task_status = None;
        followup.task_progress = None;
        followup.step = None;
        followup.tool_name = Some("Read".into());
        followup.activity = Some("src/main.rs".into());
        followup.timestamp = 43;
        let snapshot = activity_snapshot(vec![followup, event]);
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(snapshot.tasks[0].active_agent.as_deref(), Some("codex"));
        assert_eq!(snapshot.tasks[0].title, "登录功能");
        assert_eq!(snapshot.tasks[0].status, "in_progress");
        assert_eq!(snapshot.tasks[0].progress, Some(0.5));
        assert_eq!(snapshot.tasks[0].step.as_deref(), Some("编写回调"));
        assert_eq!(snapshot.tasks[0].last_tool.as_deref(), Some("Read"));
        assert_eq!(
            snapshot.tasks[0].last_activity.as_deref(),
            Some("src/main.rs")
        );
    }
}
