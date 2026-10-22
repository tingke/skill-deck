import { Search } from "lucide-react";

/** 工具栏标准搜索框：固定 --width-search（180px），复用 .input。 */
export default function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-[var(--width-search)]">
      <Search size={14} className="absolute left-3 top-2.5 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input search-input"
      />
    </div>
  );
}
