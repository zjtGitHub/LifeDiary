import { Flame, HeartPulse, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import type { DayHealth } from "../types";

export function HealthPanel({ health, loading, onSave }: {
  health: DayHealth;
  loading: boolean;
  onSave: (health: DayHealth) => Promise<void>;
}) {
  const weightJin = health.weightKg === undefined ? undefined : health.weightKg * 2;
  const [weightDraft, setWeightDraft] = useState(weightJin?.toString() ?? "");
  const [calorieDraft, setCalorieDraft] = useState(health.calorieDeficitKcal?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { setWeightDraft(weightJin?.toString() ?? ""); }, [weightJin]);
  useEffect(() => { setCalorieDraft(health.calorieDeficitKcal?.toString() ?? ""); }, [health.calorieDeficitKcal]);
  const weight = weightDraft === "" ? undefined : Number(weightDraft);
  const calories = calorieDraft === "" ? undefined : Number(calorieDraft);
  const valid = (weight === undefined || (Number.isFinite(weight) && weight > 0)) && (calories === undefined || Number.isFinite(calories));
  const changed = weight !== weightJin || calories !== health.calorieDeficitKcal;
  const edited = () => { setError(""); setNotice(""); };

  return <section className="panel health-panel" aria-label="当天健康">
    <div className="section-heading compact"><div><h2><HeartPulse size={18} aria-hidden="true" />健康</h2><p>记录当天的身体状态</p></div></div>
    <form onSubmit={async event => {
      event.preventDefault();
      if (!valid || !changed || saving || loading) return;
      setSaving(true); setError(""); setNotice("");
      try {
        await onSave({ weightKg: weight === undefined ? undefined : weight / 2, calorieDeficitKcal: calories });
        setNotice(weight === undefined && calories === undefined ? "已清除健康记录" : "健康记录已保存");
      } catch { setError("健康记录保存失败，请重试。"); }
      finally { setSaving(false); }
    }}>
      <label className="health-field"><span><Scale size={15} aria-hidden="true" />当天体重</span><span className="health-input"><input aria-label="当天体重（斤）" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="未记录" value={weightDraft} disabled={loading || saving} aria-invalid={weight !== undefined && (!Number.isFinite(weight) || weight <= 0)} onChange={event => { setWeightDraft(event.target.value); edited(); }} /><span aria-hidden="true">斤</span></span></label>
      <label className="health-field"><span><Flame size={15} aria-hidden="true" />卡路里缺口</span><span className="health-input"><input aria-label="卡路里缺口（大卡）" type="number" inputMode="decimal" step="any" placeholder="未记录" value={calorieDraft} disabled={loading || saving} onChange={event => { setCalorieDraft(event.target.value); edited(); }} /><span aria-hidden="true">大卡</span></span></label>
      <p className="health-hint">缺口可填 0，负数表示热量盈余。留空并保存可清除对应记录。</p>
      <div className="health-actions"><span className="health-status" role="status">{notice || (changed ? "待保存" : "按日期保存")}</span><button className="secondary" type="submit" aria-label="保存健康记录" disabled={loading || saving || !valid || !changed}>{saving ? "保存中…" : "保存"}</button></div>
      {error || !valid ? <p className="form-error" role="alert">{error || "请填写有效数字，体重需大于 0。"}</p> : null}
    </form>
  </section>;
}
