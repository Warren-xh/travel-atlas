export const POLICY_LABELS = {
  free: "免签 · 未去过",
  visited: "已去过",
  evisa: "提前电子签",
  orange: "授权 / 落地手续",
  purple: "附条件 / 地域限制",
  none: "普通签证 / 未核实",
};
export const EVIDENCE_LABELS = {
  verified: "入境方式有官方依据",
  channel: "渠道有依据，资格或运行待确认",
  unknown: "未取得足够官方依据",
  context: "个人情况说明",
};
export const POLICY_COLORS = {free: "#73a9d8", visited: "#73af89", evisa: "#e6c85c", orange: "#e4a06f", purple: "#aa95c8"};
export function displayCategory(policyClassification, personalStatus, policyView = true) {
  if (!policyView || personalStatus === "visited") return personalStatus || "none";
  return policyClassification || "none";
}
const PRIORITY = ["visa_free", "entry_fee", "evisa", "eta", "evoa", "voa", "arrival_permit", "online_approval", "conditional", "regular", "domestic", "unknown"];
export function policyDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function activeRoutes(entry, today = policyDate()) {
  return (entry?.routes || []).filter(r => (!r.validFrom || today >= r.validFrom) && (!r.validUntil || today <= r.validUntil));
}
export function preferredRoute(entry, today = policyDate()) {
  const active = activeRoutes(entry, today);
  const verified = active.filter(r => ["verified", "context"].includes(r.level));
  const candidates = verified.length ? verified : active;
  return [...candidates].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0] || null;
}
export function policyCategory(entry, today = policyDate()) {
  const r = preferredRoute(entry, today);
  if (!r || r.level !== "verified") return "none";
  if (["visa_free", "entry_fee"].includes(r.kind)) return "free";
  if (r.kind === "evisa") return "evisa";
  if (["eta", "voa", "evoa", "arrival_permit", "online_approval"].includes(r.kind)) return "orange";
  if (r.kind === "conditional") return "purple";
  return "none";
}
export function routeState(route, today = policyDate()) {
  if (route.validFrom && today < route.validFrom) return "尚未生效";
  if (route.validUntil && today > route.validUntil) return "政策已到期";
  if (route.validUntil) {
    const days = (Date.parse(route.validUntil + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000;
    return days === 0 ? "当日为政策最后一天" : days <= 30 ? `距离到期 ${days} 天` : "截至 " + route.validUntil;
  }
  return "未列明政策截止日";
}
