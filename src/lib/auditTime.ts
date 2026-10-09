/** 审查时间展示：本地时区 MM-DD HH:mm；支持 ISO 与 epoch 秒/毫秒；无效输入原样返回 */
export function formatAuditTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  let date = new Date(iso);
  if (Number.isNaN(date.getTime()) && /^\d{10,13}$/.test(iso)) {
    const raw = Number(iso);
    date = new Date(iso.length === 13 ? raw : raw * 1000);
  }
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
