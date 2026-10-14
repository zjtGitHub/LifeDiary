import { useCallback, useEffect, useState } from "react";
import { getProfile, getWeekSummary, saveBirthDate } from "../../lib/db";
import type { ISODate, Profile, WeekSummary } from "../../types";
import { LifeGrid } from "./LifeGrid";

interface LifePageProps {
  selectedDate: ISODate;
  onSelectDiaryDate: (date: ISODate) => void;
}

export function LifePage({ selectedDate, onSelectDiaryDate }: LifePageProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<{ startDate: ISODate; endDate: ISODate } | null>(null);
  const [weekSummary, setWeekSummary] = useState<WeekSummary | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    getProfile().then(nextProfile => {
      if (alive) { setProfile(nextProfile); setError(""); }
    }).catch(() => {
      if (alive) setError("人生数据加载失败，请重试。");
    });
    return () => { alive = false; };
  }, [version]);

  useEffect(() => {
    const refresh = () => setVersion(previous => previous + 1);
    window.addEventListener("diary-data-changed", refresh);
    return () => window.removeEventListener("diary-data-changed", refresh);
  }, []);

  useEffect(() => {
    let alive = true;
    setWeekSummary(null);
    if (selectedWeek) {
      getWeekSummary(selectedWeek.startDate, selectedWeek.endDate).then(summary => {
        if (alive) { setWeekSummary(summary); setError(""); }
      }).catch(() => {
        if (alive) setError("周回顾加载失败，请重试。");
      });
    }
    return () => { alive = false; };
  }, [selectedWeek, version]);

  const handleSelectWeek = useCallback((startDate: ISODate, endDate: ISODate) => {
    setError("");
    setSelectedWeek({ startDate, endDate });
  }, []);

  const handleSaveBirthDate = async (birthDate: ISODate) => {
    const nextProfile = await saveBirthDate(birthDate);
    setProfile(nextProfile);
    setSelectedWeek(null);
    setWeekSummary(null);
  };

  return (
    <main className="app-shell life-page">
      <header className="app-header">
        <div>
          <p className="eyebrow">时间 · 成长 · 回顾</p>
          <h1>人生</h1>
          <p className="page-description">把每一周放回人生，看看走过的路，也想想接下来。</p>
        </div>
      </header>
      {error ? <p className="form-error" role="alert">{error}<button type="button" className="stock-text-button" onClick={() => setVersion(previous => previous + 1)}>重试</button></p> : null}
      {profile ? (
        <LifeGrid
          birthDate={profile.birthDate}
          selectedDate={selectedWeek?.startDate ?? selectedDate}
          weekSummary={weekSummary}
          onSaveBirthDate={handleSaveBirthDate}
          onSelectDate={onSelectDiaryDate}
          onSelectWeek={handleSelectWeek}
        />
      ) : !error ? <p role="status">正在加载人生表格…</p> : null}
      {selectedWeek && !weekSummary && !error ? <p role="status">正在加载周回顾…</p> : null}
    </main>
  );
}
