"use client";

import { useMemo, useState } from "react";
import {
  BUDGET_LEVEL,
  DRIVE_BUCKETS,
  FOCUS_TAGS,
  WHO,
  type DriveBucket,
} from "@/lib/schema/answers";
import { QuestionShell } from "./QuestionShell";
import { ProgressBar } from "./ProgressBar";
import { Chip, CityField, DateTimeField, OptionButton, TextArea, TextField, type CityChoice } from "./Inputs";
import { INTENT_COLOR } from "@/lib/intent";

export type DraftAnswers = {
  /** Null until a city is confirmed from the autocomplete list. */
  origin: CityChoice | null;
  departAt: string;
  returnBy: string;
  driveBucket: DriveBucket | null;
  who: keyof typeof WHO | null;
  focus: (keyof typeof FOCUS_TAGS)[];
  focusText: string;
  budgetLevel: keyof typeof BUDGET_LEVEL | null;
  freeText: string;
};

const TOTAL_STEPS = 8;

/** Local datetime string for an <input type="datetime-local">. */
function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nextWeekend(): { depart: string; back: string } {
  const sat = new Date();
  sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7 || 7));
  sat.setHours(8, 0, 0, 0);
  const sun = new Date(sat);
  sun.setDate(sun.getDate() + 1);
  sun.setHours(20, 0, 0, 0);
  return { depart: localInputValue(sat), back: localInputValue(sun) };
}

export function PlannerFlow({ onSubmit }: { onSubmit: (a: DraftAnswers) => void }) {
  const defaults = useMemo(() => nextWeekend(), []);
  // Captured once at mount: reading the clock during render is impure and
  // makes the gate flicker on unrelated re-renders. The authoritative check
  // is server-side anyway; this only gates the Continue button.
  const [mountedAt] = useState(() => Date.now());
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [a, setA] = useState<DraftAnswers>({
    origin: null,
    departAt: defaults.depart,
    returnBy: defaults.back,
    driveBucket: null,
    who: null,
    focus: [],
    focusText: "",
    budgetLevel: null,
    freeText: "",
  });

  const set = <K extends keyof DraftAnswers>(k: K, v: DraftAnswers[K]) =>
    setA((prev) => ({ ...prev, [k]: v }));

  const go = (delta: 1 | -1) => {
    setDirection(delta);
    setStep((s) => Math.max(0, Math.min(TOTAL_STEPS - 1, s + delta)));
  };

  const windowHours = useMemo(() => {
    const d = new Date(a.departAt).getTime();
    const b = new Date(a.returnBy).getTime();
    if (Number.isNaN(d) || Number.isNaN(b) || b <= d) return 0;
    return (b - d) / 3_600_000;
  }, [a.departAt, a.returnBy]);

  /**
   * Drive-time buckets that cannot fit the chosen window are disabled with a
   * reason, rather than collected and rejected later. A Saturday-only window
   * genuinely cannot absorb a 5-hour each-way drive, and saying so here is
   * better than discovering it after a 40-second pipeline run.
   */
  const bucketFits = (key: DriveBucket) =>
    windowHours > 0 && DRIVE_BUCKETS[key].maxHours * 2 < windowHours * 0.75;

  const next = () => (step === TOTAL_STEPS - 1 ? onSubmit(a) : go(1));
  const back = step > 0 ? () => go(-1) : undefined;

  const shell = (props: Parameters<typeof QuestionShell>[0]) => (
    <>
      <ProgressBar current={step} total={TOTAL_STEPS} />
      <QuestionShell {...props} />
    </>
  );

  switch (step) {
    case 0:
      return shell({
        stepKey: "origin",
        direction,
        eyebrow: "Where from",
        question: "Where are you starting?",
        hint: "Pick from the list — we measure every drive, forecast, and search from this exact point.",
        // Requires a confirmed Google place, not free text.
        canAdvance: a.origin !== null,
        onNext: next,
        children: <CityField selected={a.origin} onSelect={(v) => set("origin", v)} />,
      });

    case 1:
      return shell({
        stepKey: "depart",
        direction,
        eyebrow: "Departure",
        question: "When are you leaving?",
        hint: "Traffic is checked for this exact time, so a 7am Saturday start is a different drive from a 6pm Friday one.",
        canAdvance: Boolean(a.departAt) && new Date(a.departAt).getTime() > mountedAt,
        onNext: next,
        onBack: back,
        children: (
          <DateTimeField
            value={a.departAt}
            min={localInputValue(new Date())}
            onChange={(v) => set("departAt", v)}
          />
        ),
      });

    case 2:
      return shell({
        stepKey: "return",
        direction,
        eyebrow: "Return",
        question: "When do you need to be back?",
        hint: windowHours > 0 ? `That's a ${Math.round(windowHours)}-hour window.` : undefined,
        canAdvance: windowHours > 0,
        onNext: next,
        onBack: back,
        children: (
          <DateTimeField value={a.returnBy} min={a.departAt} onChange={(v) => set("returnBy", v)} />
        ),
      });

    case 3:
      return shell({
        stepKey: "drive",
        direction,
        eyebrow: "Distance",
        question: "How far are you willing to drive?",
        hint: "One way. Options that don't fit your window are greyed out.",
        canAdvance: a.driveBucket !== null,
        onNext: next,
        onBack: back,
        children: (
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(DRIVE_BUCKETS) as DriveBucket[]).map((key) => {
              const fits = bucketFits(key);
              return (
                <OptionButton
                  key={key}
                  label={DRIVE_BUCKETS[key].label}
                  selected={a.driveBucket === key}
                  disabled={!fits}
                  note={fits ? undefined : "Too much driving for this window"}
                  onClick={() => set("driveBucket", key)}
                />
              );
            })}
          </div>
        ),
      });

    case 4:
      return shell({
        stepKey: "who",
        direction,
        eyebrow: "Company",
        question: "Who's going?",
        hint: "This changes pacing and the kind of places that make sense.",
        canAdvance: a.who !== null,
        onNext: next,
        onBack: back,
        children: (
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(WHO) as (keyof typeof WHO)[]).map((key) => (
              <OptionButton
                key={key}
                label={WHO[key]}
                selected={a.who === key}
                onClick={() => set("who", key)}
              />
            ))}
          </div>
        ),
      });

    case 5:
      return shell({
        stepKey: "focus",
        direction,
        eyebrow: "The point",
        question: "What's this weekend for?",
        hint: "Tap what fits, or just tell us in your own words. Either works.",
        // Tags OR free text. Forcing chips on someone who knows exactly what
        // they want costs signal rather than gaining it.
        canAdvance: a.focus.length > 0 || a.focusText.trim().length > 2,
        onNext: next,
        onBack: back,
        children: (
          <div className="space-y-7">
            <div className="flex flex-wrap gap-2.5">
              {(Object.keys(FOCUS_TAGS) as (keyof typeof FOCUS_TAGS)[]).map((key) => {
                const selected = a.focus.includes(key);
                return (
                  <Chip
                    key={key}
                    label={FOCUS_TAGS[key]}
                    selected={selected}
                    accent={INTENT_COLOR[key]}
                    disabled={!selected && a.focus.length >= 4}
                    onClick={() =>
                      set(
                        "focus",
                        selected ? a.focus.filter((f) => f !== key) : [...a.focus, key],
                      )
                    }
                  />
                );
              })}
            </div>

            <div>
              <p className="mb-2.5 font-sans text-xs text-slate-400">
                Or describe it yourself — this counts for more than the tags
              </p>
              <TextArea
                value={a.focusText}
                onChange={(v) => set("focusText", v.slice(0, 400))}
                placeholder="e.g. somewhere green and quiet where we can walk a lot and eat well, nothing touristy"
              />
            </div>
          </div>
        ),
      });

    case 6:
      return shell({
        stepKey: "budget",
        direction,
        eyebrow: "Budget",
        question: "How are we spending?",
        canAdvance: a.budgetLevel !== null,
        onNext: next,
        onBack: back,
        children: (
          <div className="grid gap-3">
            {(Object.keys(BUDGET_LEVEL) as (keyof typeof BUDGET_LEVEL)[]).map((key) => (
              <OptionButton
                key={key}
                label={BUDGET_LEVEL[key]}
                selected={a.budgetLevel === key}
                onClick={() => set("budgetLevel", key)}
              />
            ))}
          </div>
        ),
      });

    default:
      return shell({
        stepKey: "free",
        direction,
        eyebrow: "Last one",
        question: "Anything you're craving, or want to avoid?",
        hint: "Optional. Dietary needs, mobility limits, no beaches, travelling with a toddler...",
        canAdvance: true,
        isLast: true,
        onNext: next,
        onBack: back,
        children: (
          <TextField
            value={a.freeText}
            onChange={(v) => set("freeText", v.slice(0, 400))}
            placeholder="Type anything, or skip"
            autoFocus
            onEnter={next}
          />
        ),
      });
  }
}
