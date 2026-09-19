"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DAY_NAMES } from "@/lib/time";
import type { Slot } from "@/lib/types";

export function SlotManager({ initialSlots, timezone }: { initialSlots: Slot[]; timezone: string }) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [draft, setDraft] = useState({ day_of_week: 1, time_local: "09:00", label: "", preferred: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...draft,
        label: draft.label || null,
        preferred: draft.preferred || null,
      }),
    });
    const body = await response.json();
    setBusy(false);

    if (response.ok) {
      setSlots((s) =>
        [...s, body.slot].sort(
          (a, b) => a.day_of_week - b.day_of_week || a.time_local.localeCompare(b.time_local),
        ),
      );
      setDraft((d) => ({ ...d, label: "", preferred: "" }));
      router.refresh();
    } else {
      setError(body.error ?? "Could not add that slot.");
    }
  }

  async function toggle(slot: Slot) {
    const response = await fetch(`/api/slots/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !slot.active }),
    });
    if (response.ok) {
      setSlots((s) => s.map((x) => (x.id === slot.id ? { ...x, active: !x.active } : x)));
      router.refresh();
    }
  }

  async function remove(slot: Slot) {
    if (!confirm(`Remove the ${DAY_NAMES[slot.day_of_week]} ${slot.time_local} slot?`)) return;
    const response = await fetch(`/api/slots/${slot.id}`, { method: "DELETE" });
    if (response.ok) {
      setSlots((s) => s.filter((x) => x.id !== slot.id));
      router.refresh();
    }
  }

  const byDay = DAY_NAMES.map((name, index) => ({
    name,
    index,
    slots: slots.filter((s) => s.day_of_week === index),
  }));

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-lg font-semibold">Slots</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          The weekly grid. When Claude Code asks for the next free slot, it gets the earliest
          opening on this template that nothing is booked on. Times are wall clock in{" "}
          <strong>{timezone}</strong>.
        </p>
      </div>

      <div className="card mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a slot</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="dow">
              Day
            </label>
            <select
              id="dow"
              className="field w-36"
              value={draft.day_of_week}
              onChange={(e) => setDraft({ ...draft, day_of_week: Number(e.target.value) })}
            >
              {DAY_NAMES.map((name, i) => (
                <option key={name} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="time">
              Time
            </label>
            <input
              id="time"
              type="time"
              className="field w-28"
              value={draft.time_local}
              onChange={(e) => setDraft({ ...draft, time_local: e.target.value })}
            />
          </div>

          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="label">
              Label
            </label>
            <input
              id="label"
              className="field"
              placeholder="Mon morning"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>

          <div className="min-w-40 flex-1">
            <label className="label" htmlFor="preferred">
              Meant for
            </label>
            <input
              id="preferred"
              className="field"
              placeholder="carousel, data-backed"
              value={draft.preferred}
              onChange={(e) => setDraft({ ...draft, preferred: e.target.value })}
            />
          </div>

          <button className="btn-primary" onClick={add} disabled={busy}>
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {byDay.map((day) => (
          <div key={day.name} className="card p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {day.name}
            </h3>

            {day.slots.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-300">No slots</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {day.slots.map((slot) => (
                  <li
                    key={slot.id}
                    className={`group rounded-lg border px-2 py-1.5 ${
                      slot.active ? "border-neutral-200" : "border-neutral-100 bg-neutral-50 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums">{slot.time_local}</span>
                      <button
                        onClick={() => toggle(slot)}
                        className="text-[10px] uppercase tracking-wide text-neutral-400 hover:text-neutral-900"
                      >
                        {slot.active ? "on" : "off"}
                      </button>
                      <button
                        onClick={() => remove(slot)}
                        className="ml-auto hidden text-xs text-neutral-400 hover:text-red-600 group-hover:block"
                      >
                        ✕
                      </button>
                    </div>
                    {slot.label && <p className="text-xs text-neutral-500">{slot.label}</p>}
                    {slot.preferred && (
                      <p className="text-[11px] text-neutral-400">{slot.preferred}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
