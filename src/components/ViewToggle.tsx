/** 网格/列表视图切换（.seg 分段控件），放在 PageHeader 的 toolbar 槽。 */
export default function ViewToggle({
  mode,
  onChange,
}: {
  mode: "grid" | "list";
  onChange: (mode: "grid" | "list") => void;
}) {
  return (
    <div className="seg shrink-0" role="tablist" aria-label="视图切换">
      <button className={"seg-btn" + (mode === "grid" ? " on" : "")} onClick={() => onChange("grid")}>
        网格
      </button>
      <button className={"seg-btn" + (mode === "list" ? " on" : "")} onClick={() => onChange("list")}>
        列表
      </button>
    </div>
  );
}
