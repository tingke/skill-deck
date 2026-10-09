use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

pub const DEFAULT_MCP_REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0.1/servers";
const MAX_MANIFEST_BYTES: usize = 5 * 1024 * 1024;
const MAX_REGISTRY_PAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_MARKET_ITEMS: usize = 500;

#[derive(Debug, Deserialize, Serialize)]
pub struct MarketplaceSyncInput {
    pub url: String,
    pub max_items: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct MarketplaceSkillSource {
    /// 当前市场仅支持 HTTPS Git 来源，避免在线目录把用户引导到本机路径。
    pub kind: String,
    pub source_ref: String,
    #[serde(default)]
    pub subdir: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct MarketplaceInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub placeholder: String,
    #[serde(default)]
    pub is_secret: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct MarketplaceSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
    pub homepage: Option<String>,
    pub source: MarketplaceSkillSource,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct MarketplaceMcp {
    pub id: String,
    pub name: String,
    pub server_name: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
    pub version: Option<String>,
    pub homepage: Option<String>,
    pub config: Option<serde_json::Value>,
    pub required_inputs: Vec<MarketplaceInput>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
pub struct MarketplaceCatalog {
    pub source_kind: String,
    pub source_url: String,
    pub name: String,
    pub synced_at: String,
    pub skills: Vec<MarketplaceSkill>,
    pub mcps: Vec<MarketplaceMcp>,
}

#[derive(Debug, Deserialize)]
struct MarketplaceManifest {
    version: u8,
    name: String,
    #[serde(default)]
    skills: Vec<ManifestSkill>,
    #[serde(default)]
    mcps: Vec<ManifestMcp>,
}

#[derive(Debug, Deserialize)]
struct ManifestSkill {
    id: String,
    name: String,
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    tags: Vec<String>,
    homepage: Option<String>,
    source: MarketplaceSkillSource,
}

#[derive(Debug, Deserialize)]
struct ManifestMcp {
    id: String,
    name: String,
    server_name: String,
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    tags: Vec<String>,
    version: Option<String>,
    homepage: Option<String>,
    config: Option<serde_json::Value>,
    #[serde(default)]
    required_inputs: Vec<MarketplaceInput>,
}

#[derive(Debug, Deserialize)]
struct RegistryPage {
    servers: Vec<RegistryEntry>,
    #[serde(default)]
    metadata: RegistryPageMetadata,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPageMetadata {
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegistryEntry {
    server: RegistryServer,
    #[serde(default)]
    _meta: RegistryEntryMeta,
}

#[derive(Debug, Default, Deserialize)]
struct RegistryEntryMeta {
    #[serde(rename = "io.modelcontextprotocol.registry/official", default)]
    official: Option<RegistryOfficialMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryOfficialMeta {
    #[serde(default)]
    is_latest: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryServer {
    name: String,
    description: String,
    #[serde(default)]
    title: Option<String>,
    version: String,
    #[serde(default)]
    website_url: Option<String>,
    #[serde(default)]
    repository: Option<RegistryRepository>,
    #[serde(default)]
    remotes: Vec<RegistryRemote>,
    #[serde(default)]
    packages: Vec<RegistryPackage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRepository {
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRemote {
    #[serde(rename = "type")]
    transport_type: String,
    url: String,
    #[serde(default)]
    headers: Vec<RegistryKeyValue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPackage {
    registry_type: String,
    identifier: String,
    #[serde(default)]
    runtime_hint: Option<String>,
    #[serde(default)]
    runtime_arguments: Vec<RegistryArgument>,
    #[serde(default)]
    package_arguments: Vec<RegistryArgument>,
    #[serde(default)]
    environment_variables: Vec<RegistryKeyValue>,
    #[serde(default)]
    transport: Option<RegistryLocalTransport>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryLocalTransport {
    #[serde(rename = "type")]
    transport_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryArgument {
    #[serde(rename = "type")]
    argument_type: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    value_hint: Option<String>,
    #[serde(default)]
    is_required: bool,
    #[serde(default)]
    is_repeated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryKeyValue {
    name: String,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    default: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    placeholder: Option<String>,
    #[serde(default)]
    is_required: bool,
    #[serde(default)]
    is_secret: bool,
}

fn now_iso() -> String {
    chrono_like_now()
}

/// 保持与项目现有 now_iso 输出一致的 UTC ISO-8601 字符串。
fn chrono_like_now() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    let seconds = (millis / 1000) as i64;
    let remainder = (millis % 1000) as u32;
    let days = seconds.div_euclid(86_400);
    let time = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year,
        month,
        day,
        time / 3600,
        (time % 3600) / 60,
        time % 60,
        remainder
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

fn validate_https_url_shape(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|e| format!("无效 URL: {}", e))?;
    if url.scheme() != "https" {
        return Err("市场来源仅支持 HTTPS".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("市场 URL 不允许携带凭证".to_string());
    }
    if url.fragment().is_some() {
        return Err("市场 URL 不允许携带 fragment".to_string());
    }
    let Some(host) = url.host_str() else {
        return Err("市场 URL 缺少 host".to_string());
    };
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") || lower.ends_with(".local") {
        return Err("市场来源不允许指向本机或本地域名".to_string());
    }
    if host.parse::<IpAddr>().is_ok() {
        return Err("市场来源不允许直接使用 IP 地址".to_string());
    }
    Ok(url)
}

fn validate_https_url(raw: &str) -> Result<Url, String> {
    let url = validate_https_url_shape(raw)?;
    let Some(host) = url.host_str() else {
        return Err("市场 URL 缺少 host".to_string());
    };

    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("解析市场 host 失败: {}", e))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err("市场 host 没有可用的解析结果".to_string());
    }
    if addresses.iter().any(|address| is_private_ip(address.ip())) {
        return Err("市场来源不允许指向私网地址".to_string());
    }
    Ok(url)
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_loopback()
                || value.is_private()
                || value.is_link_local()
                || value.is_unspecified()
                || octets_in(&value.octets(), &[169, 254])
                || octets_in(&value.octets(), &[0, 0])
        }
        IpAddr::V6(value) => {
            value.is_loopback() || value.is_unspecified() || {
                let segments = value.segments();
                segments[0] & 0xffc0 == 0xfe80 || segments[0] == 0x2001 && segments[1] == 0x0db8
            }
        }
    }
}

fn octets_in(value: &[u8; 4], prefix: &[u8; 2]) -> bool {
    value[..2] == *prefix
}

fn validate_limited_text(value: &str, field: &str, max: usize) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{}不能为空", field));
    }
    if trimmed.len() > max {
        return Err(format!("{}超过 {} 字符限制", field, max));
    }
    Ok(())
}

fn validate_tags(tags: &[String]) -> Result<(), String> {
    if tags.len() > 20 {
        return Err("每个市场条目最多 20 个标签".to_string());
    }
    for tag in tags {
        validate_limited_text(tag, "标签", 40)?;
    }
    Ok(())
}

fn validate_skill_source(source: &MarketplaceSkillSource) -> Result<(), String> {
    if source.kind != "git" {
        return Err("市场 Skill 目前仅支持 git 来源".to_string());
    }
    validate_https_url_shape(&source.source_ref)?;
    if let Some(subdir) = source.subdir.as_deref() {
        let path = std::path::Path::new(subdir);
        if path.is_absolute() {
            return Err("市场 Skill 子目录不能是绝对路径".to_string());
        }
        if path
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err("市场 Skill 子目录包含非法路径片段".to_string());
        }
    }
    Ok(())
}

fn is_placeholder(value: &str) -> bool {
    value.starts_with("{{config.") && value.ends_with("}}")
}

fn valid_input_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.')
}

fn collect_config_placeholders(
    value: &serde_json::Value,
    names: &mut HashSet<String>,
) -> Result<(), String> {
    match value {
        serde_json::Value::String(text) => {
            const PREFIX: &str = "{{config.";
            let mut cursor = 0;
            while let Some(relative_offset) = text[cursor..].find(PREFIX) {
                let start = cursor + relative_offset;
                let value_start = start + PREFIX.len();
                let Some(end) = text[value_start..].find("}}") else {
                    return Err("市场 MCP 配置包含未闭合的 {{config.*}} 占位符".to_string());
                };
                let name = &text[value_start..value_start + end];
                if !valid_input_name(name) {
                    return Err(format!("市场 MCP 占位符名称非法: {}", name));
                }
                names.insert(name.to_string());
                cursor = value_start + end + 2;
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_config_placeholders(item, names)?;
            }
        }
        serde_json::Value::Object(map) => {
            for item in map.values() {
                collect_config_placeholders(item, names)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_config_inputs(
    config: &serde_json::Value,
    inputs: &[MarketplaceInput],
) -> Result<(), String> {
    let mut expected = HashSet::new();
    collect_config_placeholders(config, &mut expected)?;
    let mut actual = HashSet::new();
    for input in inputs {
        if !valid_input_name(&input.name) {
            return Err(format!("市场 MCP 输入名称非法: {}", input.name));
        }
        if !actual.insert(input.name.clone()) {
            return Err(format!("市场 MCP 输入名称重复: {}", input.name));
        }
    }
    if expected != actual {
        return Err("市场 MCP 配置占位符与 required_inputs 不一致".to_string());
    }
    Ok(())
}

fn looks_like_secret(value: &str) -> bool {
    let trimmed = value.trim();
    if is_placeholder(trimmed) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("bearer ") {
        return true;
    }
    trimmed.starts_with("ghp_")
        || trimmed.starts_with("github_pat_")
        || trimmed.starts_with("sk-")
        || trimmed.starts_with("xoxb-")
        || trimmed.starts_with("xoxp-")
        || trimmed.starts_with("aiza")
        || trimmed.starts_with("ey") && trimmed.matches('.').count() >= 2
}

fn reject_embedded_secrets(value: &serde_json::Value, path: &str) -> Result<(), String> {
    match value {
        serde_json::Value::String(text) => {
            if looks_like_secret(text) {
                return Err(format!("市场 MCP 配置在 {} 中包含疑似密钥", path));
            }
        }
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                reject_embedded_secrets(item, &format!("{}[{}]", path, index))?;
            }
        }
        serde_json::Value::Object(map) => {
            for (key, item) in map {
                reject_embedded_secrets(item, &format!("{}.{}", path, key))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn parse_manifest(raw: &[u8], source_url: &str) -> Result<MarketplaceCatalog, String> {
    let manifest: MarketplaceManifest =
        serde_json::from_slice(raw).map_err(|e| format!("市场 manifest 解析失败: {}", e))?;
    if manifest.version != 1 {
        return Err(format!("不支持的市场 manifest 版本: {}", manifest.version));
    }
    validate_limited_text(&manifest.name, "市场名称", 120)?;
    if manifest.skills.len() + manifest.mcps.len() > MAX_MARKET_ITEMS {
        return Err(format!("市场条目超过 {} 个", MAX_MARKET_ITEMS));
    }

    let mut ids = HashSet::new();
    let mut skills = Vec::new();
    for skill in manifest.skills {
        validate_limited_text(&skill.id, "Skill ID", 200)?;
        validate_limited_text(&skill.name, "Skill 名称", 160)?;
        validate_limited_text(&skill.description, "Skill 描述", 1000)?;
        validate_tags(&skill.tags)?;
        validate_skill_source(&skill.source)?;
        if let Some(homepage) = skill.homepage.as_deref() {
            validate_https_url_shape(homepage)?;
        }
        if !ids.insert(skill.id.clone()) {
            return Err(format!("市场条目 ID 重复: {}", skill.id));
        }
        skills.push(MarketplaceSkill {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            author: skill.author,
            tags: skill.tags,
            homepage: skill.homepage,
            source: skill.source,
        });
    }

    let mut mcps = Vec::new();
    for mcp in manifest.mcps {
        validate_limited_text(&mcp.id, "MCP ID", 200)?;
        validate_limited_text(&mcp.name, "MCP 名称", 160)?;
        validate_limited_text(&mcp.description, "MCP 描述", 1000)?;
        validate_limited_text(&mcp.server_name, "MCP server 名称", 200)?;
        validate_tags(&mcp.tags)?;
        if let Some(homepage) = mcp.homepage.as_deref() {
            validate_https_url_shape(homepage)?;
        }
        if let Some(config) = mcp.config.as_ref() {
            if !config.is_object() {
                return Err(format!("MCP {} 的 config 必须是对象", mcp.id));
            }
            reject_embedded_secrets(config, "config")?;
            validate_config_inputs(config, &mcp.required_inputs)?;
        }
        for input in &mcp.required_inputs {
            validate_limited_text(&input.name, "MCP 输入名称", 100)?;
            if input.description.len() > 500 {
                return Err("MCP 输入说明超过 500 字符限制".to_string());
            }
            if input.placeholder.len() > 200 {
                return Err("MCP 输入提示超过 200 字符限制".to_string());
            }
        }
        if !ids.insert(mcp.id.clone()) {
            return Err(format!("市场条目 ID 重复: {}", mcp.id));
        }
        mcps.push(MarketplaceMcp {
            id: mcp.id,
            name: mcp.name,
            server_name: mcp.server_name,
            description: mcp.description,
            author: mcp.author,
            tags: mcp.tags,
            version: mcp.version,
            homepage: mcp.homepage,
            config: mcp.config,
            required_inputs: mcp.required_inputs,
        });
    }

    Ok(MarketplaceCatalog {
        source_kind: "manifest".to_string(),
        source_url: source_url.to_string(),
        name: manifest.name,
        synced_at: now_iso(),
        skills,
        mcps,
    })
}

fn placeholder(name: &str) -> String {
    format!("{{{{config.{}}}}}", name)
}

fn registry_input(
    name: &str,
    description: Option<&str>,
    placeholder_text: Option<&str>,
    is_secret: bool,
) -> MarketplaceInput {
    MarketplaceInput {
        name: name.to_string(),
        description: description.unwrap_or(name).to_string(),
        placeholder: placeholder_text.unwrap_or_default().to_string(),
        is_secret,
    }
}

fn push_required(required: &mut Vec<MarketplaceInput>, input: MarketplaceInput) {
    if !required.iter().any(|item| item.name == input.name) {
        required.push(input);
    }
}

fn sanitized_input_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '.' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "input".to_string()
    } else {
        cleaned
    }
}

fn unique_input_name(base: &str, required: &[MarketplaceInput]) -> String {
    let mut candidate = base.to_string();
    let mut suffix = 2;
    while required.iter().any(|input| input.name == candidate) {
        candidate = format!("{}-{}", base, suffix);
        suffix += 1;
    }
    candidate
}

fn key_value(
    input: &RegistryKeyValue,
    values: &mut serde_json::Map<String, serde_json::Value>,
    required: &mut Vec<MarketplaceInput>,
) -> Option<()> {
    if input.is_secret {
        if input.is_required {
            push_required(
                required,
                registry_input(
                    &input.name,
                    input.description.as_deref(),
                    input.placeholder.as_deref(),
                    true,
                ),
            );
            values.insert(
                input.name.clone(),
                serde_json::Value::String(placeholder(&input.name)),
            );
        }
        return Some(());
    }
    let Some(value) = input.default.clone().or_else(|| input.value.clone()) else {
        if input.is_required {
            push_required(
                required,
                registry_input(
                    &input.name,
                    input.description.as_deref(),
                    input.placeholder.as_deref(),
                    false,
                ),
            );
            values.insert(
                input.name.clone(),
                serde_json::Value::String(placeholder(&input.name)),
            );
        }
        return Some(());
    };
    if looks_like_secret(&value) {
        return None;
    }
    values.insert(input.name.clone(), serde_json::Value::String(value));
    Some(())
}

fn argument_value(
    argument: &RegistryArgument,
    required: &mut Vec<MarketplaceInput>,
) -> Option<Option<String>> {
    let display_name = argument
        .name
        .clone()
        .or_else(|| argument.value_hint.clone())
        .unwrap_or_else(|| format!("argument-{}", required.len() + 1));
    let input_name = unique_input_name(&sanitized_input_name(&display_name), required);
    if let Some(value) = argument.default.clone() {
        if !looks_like_secret(&value) {
            return Some(Some(value));
        }
        return None;
    }
    if let Some(value) = argument.value.clone() {
        if !looks_like_secret(&value) {
            return Some(Some(value));
        }
        return None;
    }
    if !argument.is_required {
        return Some(None);
    }
    push_required(
        required,
        registry_input(&input_name, Some(&display_name), None, false),
    );
    Some(Some(placeholder(&input_name)))
}

fn push_argument(
    argument: &RegistryArgument,
    args: &mut Vec<String>,
    required: &mut Vec<MarketplaceInput>,
) -> Option<()> {
    let value = match argument_value(argument, required)? {
        Some(value) => value,
        None => return Some(()),
    };
    if argument.argument_type == "named" {
        let name = argument.name.as_deref()?;
        args.push(format!("{}={}", name, value));
    } else {
        args.push(value);
    }
    if argument.is_repeated {
        // schema 的重复参数需要提供具体值；生成不确定数量会误导用户。
        return None;
    }
    Some(())
}

fn registry_config(server: &RegistryServer) -> Option<(serde_json::Value, Vec<MarketplaceInput>)> {
    let mut required = Vec::new();
    let remote = server.remotes.iter().find(|remote| {
        (remote.transport_type == "streamable-http" || remote.transport_type == "sse")
            && remote.url.starts_with("https://")
            && !remote.url.contains('{')
    });
    if let Some(remote) = remote {
        let mut config = serde_json::Map::new();
        config.insert(
            "type".to_string(),
            serde_json::Value::String(
                if remote.transport_type == "streamable-http" {
                    "http"
                } else {
                    "sse"
                }
                .to_string(),
            ),
        );
        config.insert(
            "url".to_string(),
            serde_json::Value::String(remote.url.clone()),
        );
        if !remote.headers.is_empty() {
            let mut headers = serde_json::Map::new();
            for header in &remote.headers {
                key_value(header, &mut headers, &mut required)?;
            }
            if !headers.is_empty() {
                config.insert("headers".to_string(), serde_json::Value::Object(headers));
            }
            let config = serde_json::Value::Object(config);
            validate_config_inputs(&config, &required).ok()?;
            return Some((config, required));
        }
        return Some((serde_json::Value::Object(config), required));
    }

    let package = server.packages.iter().find(|package| {
        package.registry_type == "npm"
            && package
                .transport
                .as_ref()
                .map(|transport| transport.transport_type == "stdio")
                .unwrap_or(false)
    })?;
    let runtime = package.runtime_hint.as_deref().unwrap_or("npx");
    if runtime.contains('/') || runtime.contains("..") || runtime.contains(' ') {
        return None;
    }
    let mut args = Vec::new();
    if runtime == "npx" {
        args.push("-y".to_string());
    }
    for argument in &package.runtime_arguments {
        push_argument(argument, &mut args, &mut required)?;
    }
    args.push(package.identifier.clone());
    for argument in &package.package_arguments {
        push_argument(argument, &mut args, &mut required)?;
    }
    let mut config = serde_json::Map::new();
    config.insert(
        "command".to_string(),
        serde_json::Value::String(runtime.to_string()),
    );
    config.insert(
        "args".to_string(),
        serde_json::Value::Array(args.into_iter().map(serde_json::Value::String).collect()),
    );
    if !package.environment_variables.is_empty() {
        let mut env = serde_json::Map::new();
        for variable in &package.environment_variables {
            key_value(variable, &mut env, &mut required)?;
        }
        if !env.is_empty() {
            config.insert("env".to_string(), serde_json::Value::Object(env));
        }
    }
    let config = serde_json::Value::Object(config);
    validate_config_inputs(&config, &required).ok()?;
    Some((config, required))
}

fn parse_registry_page(
    raw: &[u8],
    seen: &mut HashMap<String, ()>,
) -> Result<(Vec<MarketplaceMcp>, Option<String>), String> {
    let page: RegistryPage =
        serde_json::from_slice(raw).map_err(|e| format!("MCP Registry 响应解析失败: {}", e))?;
    let mut mcps = Vec::new();
    for entry in page.servers {
        let Some(meta) = entry._meta.official else {
            continue;
        };
        if !meta.is_latest || seen.contains_key(&entry.server.name) {
            continue;
        }
        let server = entry.server;
        let (config, required_inputs) =
            registry_config(&server).unwrap_or((serde_json::Value::Null, Vec::new()));
        let homepage = server
            .website_url
            .clone()
            .or_else(|| server.repository.and_then(|repo| repo.url));
        if let Some(homepage) = homepage.as_deref() {
            if validate_https_url_shape(homepage).is_err() {
                return Err(format!(
                    "MCP Registry 条目包含不安全的 homepage: {}",
                    homepage
                ));
            }
        }
        let mut tags = vec!["registry".to_string()];
        let has_config = !config.is_null();
        if !has_config {
            tags.push("manual-config".to_string());
        }
        seen.insert(server.name.clone(), ());
        let namespace = server
            .name
            .split('/')
            .next()
            .unwrap_or("registry")
            .to_string();
        mcps.push(MarketplaceMcp {
            id: server.name.clone(),
            name: server.title.clone().unwrap_or_else(|| server.name.clone()),
            server_name: server.name.clone(),
            description: server.description,
            author: namespace,
            tags,
            version: Some(server.version),
            homepage,
            config: if has_config { Some(config) } else { None },
            required_inputs,
        });
    }
    Ok((mcps, page.metadata.next_cursor))
}

fn http_client() -> Result<Client, String> {
    // reqwest 0.13 的 rustls-no-provider 组合要求宿主显式安装 crypto provider。
    // ring 已在当前依赖图中；若其他插件先安装 provider，这里允许返回 AlreadyInstalled。
    let _ = rustls::crypto::ring::default_provider().install_default();
    Client::builder()
        .user_agent("SkillDeck-Marketplace/0.1")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("创建 HTTP client 失败: {}", e))
}

async fn fetch_bytes(client: &Client, url: &Url, max_bytes: usize) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(url.clone())
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求市场失败: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("市场返回 HTTP {}", response.status()));
    }
    if let Some(length) = response.content_length() {
        if length as usize > max_bytes {
            return Err(format!("市场响应超过 {} 字节限制", max_bytes));
        }
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取市场响应失败: {}", e))?
    {
        if body.len() + chunk.len() > max_bytes {
            return Err(format!("市场响应超过 {} 字节限制", max_bytes));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn is_mcp_registry(url: &Url) -> bool {
    url.host_str() == Some("registry.modelcontextprotocol.io") && url.path() == "/v0.1/servers"
}

async fn sync_registry(
    client: &Client,
    base: Url,
    max_items: usize,
) -> Result<MarketplaceCatalog, String> {
    let mut seen = HashMap::new();
    let mut mcps = Vec::new();
    let source_url = base.to_string();
    let base_for_pages = base.clone();
    let mut next_url = Some(base);

    while let Some(url) = next_url.take() {
        let raw = fetch_bytes(client, &url, MAX_REGISTRY_PAGE_BYTES).await?;
        let (page_mcps, cursor) = parse_registry_page(&raw, &mut seen)?;
        for mcp in page_mcps {
            if mcps.len() >= max_items {
                break;
            }
            mcps.push(mcp);
        }
        if mcps.len() >= max_items || cursor.is_none() {
            break;
        }
        let mut next = base_for_pages.clone();
        next.query_pairs_mut().clear();
        next.query_pairs_mut()
            .append_pair("cursor", cursor.as_deref().unwrap_or_default());
        next_url = Some(next);
    }

    Ok(MarketplaceCatalog {
        source_kind: "mcp-registry".to_string(),
        source_url,
        name: "MCP Registry".to_string(),
        synced_at: now_iso(),
        skills: Vec::new(),
        mcps,
    })
}

pub async fn sync_marketplace_impl(
    input: MarketplaceSyncInput,
) -> Result<MarketplaceCatalog, String> {
    let url = validate_https_url(&input.url)?;
    let max_items = input
        .max_items
        .unwrap_or(MAX_MARKET_ITEMS)
        .clamp(1, MAX_MARKET_ITEMS);
    let client = http_client()?;
    if is_mcp_registry(&url) {
        return sync_registry(&client, url, max_items).await;
    }
    let raw = fetch_bytes(&client, &url, MAX_MANIFEST_BYTES).await?;
    parse_manifest(&raw, url.as_str())
}

#[tauri::command(async)]
pub async fn sync_marketplace(input: MarketplaceSyncInput) -> Result<MarketplaceCatalog, String> {
    sync_marketplace_impl(input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn manifest_json() -> String {
        r#"{
          "version": 1,
          "name": "Example",
          "skills": [{
            "id": "example-skill",
            "name": "Example Skill",
            "description": "Example",
            "author": "example",
            "tags": ["demo"],
            "homepage": "https://example.com",
            "source": {
              "kind": "git",
              "source_ref": "https://github.com/example/skill",
              "subdir": "skills/example"
            }
          }],
          "mcps": [{
            "id": "example-mcp",
            "name": "Example MCP",
            "server_name": "example",
            "description": "Example",
            "config": {
              "command": "npx",
              "args": ["-y", "example"],
              "env": {"TOKEN": "{{config.token}}"}
            },
            "required_inputs": [{"name": "token", "description": "Token", "is_secret": true}]
          }]
        }"#
        .to_string()
    }

    #[test]
    fn manifest_allows_placeholders_and_subdirectories() {
        let catalog = parse_manifest(
            manifest_json().as_bytes(),
            "https://example.com/market.json",
        )
        .unwrap();
        assert_eq!(catalog.skills.len(), 1);
        assert_eq!(
            catalog.skills[0].source.subdir.as_deref(),
            Some("skills/example")
        );
        assert!(catalog.mcps[0].required_inputs[0].is_secret);
    }

    #[test]
    fn manifest_rejects_embedded_secret_and_local_path() {
        let mut manifest = manifest_json().replace("{{config.token}}", "ghp_test_token");
        assert!(parse_manifest(manifest.as_bytes(), "https://example.com/m.json").is_err());

        manifest = manifest_json().replace("https://github.com/example/skill", "/tmp/local-skill");
        assert!(parse_manifest(manifest.as_bytes(), "https://example.com/m.json").is_err());
    }

    #[test]
    fn manifest_rejects_placeholder_and_required_input_mismatch() {
        let manifest = manifest_json().replace(
            "\"token\", \"description\": \"Token\", \"is_secret\": true",
            "\"missing\", \"description\": \"Token\", \"is_secret\": true",
        );
        assert!(parse_manifest(manifest.as_bytes(), "https://example.com/m.json").is_err());

        let manifest = manifest_json().replace("{{config.token}}", "{{config.unclosed");
        assert!(parse_manifest(manifest.as_bytes(), "https://example.com/m.json").is_err());
    }

    #[test]
    fn marketplace_url_shape_rejects_local_and_credential_urls() {
        assert!(validate_https_url_shape("https://example.com/market.json").is_ok());
        for url in [
            "http://example.com/market.json",
            "https://localhost/market.json",
            "https://127.0.0.1/market.json",
            "https://user:token@example.com/market.json",
            "https://example.com/market.json#fragment",
        ] {
            assert!(
                validate_https_url_shape(url).is_err(),
                "{} should be rejected",
                url
            );
        }
    }

    #[test]
    fn registry_keeps_latest_remote_and_converts_secret_header_to_input() {
        let raw = br#"{
          "servers": [{
            "server": {
              "name": "example/server",
              "title": "Example",
              "description": "Example",
              "version": "1.0.0",
              "remotes": [{
                "type": "streamable-http",
                "url": "https://example.com/mcp",
                "headers": [{"name": "Authorization", "isRequired": true, "isSecret": true}]
              }]
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"isLatest": true}}
          }],
          "metadata": {}
        }"#;
        let mut seen = HashMap::new();
        let (mcps, cursor) = parse_registry_page(raw, &mut seen).unwrap();
        assert!(cursor.is_none());
        assert_eq!(mcps.len(), 1);
        assert_eq!(
            mcps[0].config.as_ref().unwrap()["url"],
            "https://example.com/mcp"
        );
        assert_eq!(
            mcps[0].config.as_ref().unwrap()["headers"]["Authorization"],
            "{{config.Authorization}}"
        );
        assert!(mcps[0].required_inputs[0].is_secret);
    }

    #[test]
    fn registry_converts_simple_npm_stdio_package() {
        let raw = br#"{
          "servers": [{
            "server": {
              "name": "example/server",
              "description": "Example",
              "version": "1.0.0",
              "packages": [{
                "registryType": "npm",
                "identifier": "example-mcp",
                "runtimeHint": "npx",
                "transport": {"type": "stdio"}
              }]
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"isLatest": true}}
          }]
        }"#;
        let (mcps, _) = parse_registry_page(raw, &mut HashMap::new()).unwrap();
        let config = mcps[0].config.as_ref().unwrap();
        assert_eq!(config["command"], "npx");
        assert_eq!(config["args"][0], "-y");
        assert_eq!(config["args"][1], "example-mcp");
    }

    #[test]
    fn registry_omits_optional_blank_values_instead_of_requiring_them() {
        let raw = br#"{
          "servers": [{
            "server": {
              "name": "example/server",
              "description": "Example",
              "version": "1.0.0",
              "remotes": [{
                "type": "streamable-http",
                "url": "https://example.com/mcp",
                "headers": [
                  {"name": "Authorization", "isSecret": true},
                  {"name": "X-Optional", "isRequired": false}
                ]
              }]
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"isLatest": true}}
          }]
        }"#;
        let (mcps, _) = parse_registry_page(raw, &mut HashMap::new()).unwrap();
        let config = mcps[0].config.as_ref().unwrap();
        assert!(config.get("headers").is_none());
        assert!(mcps[0].required_inputs.is_empty());
    }

    #[test]
    fn registry_required_argument_becomes_sanitized_input() {
        let raw = br#"{
          "servers": [{
            "server": {
              "name": "example/server",
              "description": "Example",
              "version": "1.0.0",
              "packages": [{
                "registryType": "npm",
                "identifier": "example-mcp",
                "runtimeHint": "npx",
                "runtimeArguments": [
                  {"type": "positional", "valueHint": "workspace path", "isRequired": true}
                ],
                "transport": {"type": "stdio"}
              }]
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"isLatest": true}}
          }]
        }"#;
        let (mcps, _) = parse_registry_page(raw, &mut HashMap::new()).unwrap();
        assert_eq!(mcps[0].required_inputs[0].name, "workspace_path");
        let config = mcps[0].config.as_ref().unwrap();
        assert_eq!(config["args"][1], "{{config.workspace_path}}");
    }

    #[test]
    fn registry_mcp_config_writes_to_isolated_custom_agent_target() {
        let root =
            std::env::temp_dir().join(format!("skilldeck-market-write-{}", uuid::Uuid::new_v4()));
        let config_path = root.join("mcp.json");
        std::fs::create_dir_all(&root).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE agents (
                id TEXT PRIMARY KEY, label TEXT NOT NULL, skills_dir TEXT NOT NULL,
                config_dir TEXT NOT NULL, mcp_config_file TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT 'slate', auto_scan INTEGER NOT NULL DEFAULT 0,
                scan_agents_dir INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE extensions (
                id TEXT PRIMARY KEY, kind TEXT NOT NULL, runtime TEXT NOT NULL,
                name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
                enabled INTEGER NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
                detail TEXT, created_at TEXT NOT NULL
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO agents (
                id, label, skills_dir, config_dir, mcp_config_file,
                created_at, updated_at
             ) VALUES ('market-test', 'Market Test', ?, ?, ?, 'now', 'now')",
            rusqlite::params![
                root.join("skills").to_string_lossy().to_string(),
                root.to_string_lossy().to_string(),
                config_path.to_string_lossy().to_string()
            ],
        )
        .unwrap();
        std::fs::write(
            &config_path,
            r#"{"unknown":"keep","mcpServers":{"other":{"url":"https://example.com/other"}}}"#,
        )
        .unwrap();

        let raw = br#"{
          "servers": [{
            "server": {
              "name": "example/server",
              "title": "Example",
              "description": "Example",
              "version": "1.0.0",
              "remotes": [{
                "type": "streamable-http",
                "url": "https://example.com/mcp",
                "headers": [{"name": "Authorization", "isRequired": true, "isSecret": true}]
              }]
            },
            "_meta": {"io.modelcontextprotocol.registry/official": {"isLatest": true}}
          }]
        }"#;
        let (mcps, _) = parse_registry_page(raw, &mut HashMap::new()).unwrap();
        let entry = &mcps[0];
        crate::extensions::save_mcp(
            &conn,
            &crate::db::McpServerInput {
                runtime: "market-test".to_string(),
                name: entry.server_name.clone(),
                config_json: entry.config.as_ref().unwrap().to_string(),
                old_name: None,
            },
        )
        .unwrap();

        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        let servers = written.get("mcpServers").unwrap();
        assert_eq!(written.get("unknown"), Some(&serde_json::json!("keep")));
        assert!(servers.get("other").is_some());
        assert_eq!(
            servers
                .get("example/server")
                .unwrap()
                .get("headers")
                .unwrap()
                .get("Authorization")
                .unwrap(),
            "{{config.Authorization}}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "network"]
    fn official_registry_live_sync_smoke() {
        let catalog = tauri::async_runtime::block_on(sync_marketplace_impl(MarketplaceSyncInput {
            url: DEFAULT_MCP_REGISTRY_URL.to_string(),
            max_items: Some(30),
        }))
        .unwrap();
        assert_eq!(catalog.source_kind, "mcp-registry");
        assert!(!catalog.mcps.is_empty());
        assert!(catalog.mcps.iter().all(|mcp| {
            mcp.config.is_some() || mcp.tags.iter().any(|tag| tag == "manual-config")
        }));
    }
}
