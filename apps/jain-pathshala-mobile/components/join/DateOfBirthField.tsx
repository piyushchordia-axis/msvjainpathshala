import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { fonts } from "@/constants/typography";
import { Body, Title } from "@/components/ui";
import { ageYearsFromDobString } from "@/lib/join";

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_HI = [
  "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
  "जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर", "दिसंबर",
];

type Part = "day" | "month" | "year";
type Draft = { day: number; month: number; year: number };

const EMPTY: Draft = { day: 0, month: 0, year: 0 };

function daysInMonth(year: number, month1: number): number {
  // Before a year is chosen, offer the longest month; emit() clamps later.
  if (!month1) return 31;
  return new Date(Date.UTC(year || 2000, month1, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parseIso(v: string | undefined): Draft {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v ?? "");
  if (!m) return EMPTY;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Date of birth entry, built from plain views — no native date module, so this
 * ships in a JS bundle without a rebuild. Three separate selectors also beat a
 * spinner for a birth year decades back: the year list is one tap and a scroll,
 * not thirty swipes.
 */
export function DateOfBirthField({
  value,
  onChange,
  hi,
  minAge,
  maxAge,
}: {
  value: string | undefined;
  onChange: (iso: string) => void;
  hi: boolean;
  minAge: number;
  maxAge: number;
}) {
  const c = useColors();
  const [open, setOpen] = useState<Part | null>(null);
  // A half-finished date is not a valid ISO string, so the parent cannot hold
  // it. Keep the partial choice here and only publish once all three are set —
  // otherwise the first tap would appear to do nothing.
  const [draft, setDraft] = useState<Draft>(() => parseIso(value));

  useEffect(() => {
    // Re-sync when the parent resets or restores the field.
    const fromParent = parseIso(value);
    if (value) setDraft(fromParent);
    else if (draft.year && draft.month && draft.day) setDraft(EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const out: number[] = [];
    // Newest first: most applicants sit nearer the young end of the band.
    for (let y = thisYear - minAge; y >= thisYear - maxAge; y -= 1) out.push(y);
    return out;
  }, [thisYear, minAge, maxAge]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(
    () => Array.from({ length: daysInMonth(draft.year, draft.month) }, (_, i) => i + 1),
    [draft.year, draft.month],
  );

  const select = (part: Part, n: number) => {
    setOpen(null);
    const next: Draft = { ...draft, [part]: n };
    // Clamp rather than publish 31 February — picking a shorter month must not
    // quietly produce a date the server will reject.
    if (next.month) next.day = Math.min(next.day, daysInMonth(next.year, next.month));
    setDraft(next);
    if (next.year && next.month && next.day) {
      onChange(`${next.year}-${pad2(next.month)}-${pad2(next.day)}`);
    }
  };

  const label = (part: Part): string => {
    if (part === "day") return draft.day ? String(draft.day) : hi ? "दिन" : "Day";
    if (part === "month") {
      if (!draft.month) return hi ? "महीना" : "Month";
      return (hi ? MONTHS_HI : MONTHS_EN)[draft.month - 1]!;
    }
    return draft.year ? String(draft.year) : hi ? "वर्ष" : "Year";
  };

  const optionsFor = (part: Part): number[] =>
    part === "day" ? days : part === "month" ? months : years;

  const optionLabelFor = (part: Part, n: number): string =>
    part === "month" ? (hi ? MONTHS_HI : MONTHS_EN)[n - 1]! : String(n);

  const isActive = (part: Part, n: number): boolean =>
    part === "day" ? draft.day === n : part === "month" ? draft.month === n : draft.year === n;

  const selectorStyle = {
    flex: 1,
    borderWidth: 1,
    borderColor: c.input,
    borderRadius: c.radius,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: c.card,
  } as const;

  const complete = !!(draft.year && draft.month && draft.day);
  const age = complete ? ageYearsFromDobString(`${draft.year}-${pad2(draft.month)}-${pad2(draft.day)}`) : NaN;

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
        {(["day", "month", "year"] as const).map((part) => {
          const chosen =
            part === "day" ? !!draft.day : part === "month" ? !!draft.month : !!draft.year;
          return (
            <Pressable key={part} onPress={() => setOpen(part)} style={selectorStyle}>
              <Body
                numberOfLines={1}
                style={{
                  fontFamily: fonts.body,
                  color: chosen ? c.foreground : c.inkDim,
                  lineHeight: 22,
                }}
              >
                {label(part)}
              </Body>
            </Pressable>
          );
        })}
      </View>

      {Number.isFinite(age) && age >= 0 ? (
        <Body muted style={{ marginTop: 6, fontSize: 13, lineHeight: 22 }}>
          {hi ? `आयु ${age} वर्ष` : `Age ${age}`}
        </Body>
      ) : null}

      <Modal
        visible={open !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        <Pressable
          onPress={() => setOpen(null)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: c.card,
              borderTopLeftRadius: c.radius * 2,
              borderTopRightRadius: c.radius * 2,
              paddingTop: 16,
              paddingBottom: 24,
              maxHeight: "70%",
            }}
          >
            <Title style={{ fontSize: 18, paddingHorizontal: 20, marginBottom: 8 }}>
              {open === "day"
                ? hi ? "दिन चुनें" : "Choose a day"
                : open === "month"
                  ? hi ? "महीना चुनें" : "Choose a month"
                  : hi ? "वर्ष चुनें" : "Choose a year"}
            </Title>
            <FlatList
              data={open ? optionsFor(open) : []}
              keyExtractor={(n) => String(n)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = !!open && isActive(open, item);
                return (
                  <Pressable
                    onPress={() => open && select(open, item)}
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 20,
                      backgroundColor: active ? c.accent : "transparent",
                    }}
                  >
                    <Body style={{ color: active ? c.primary : c.foreground, lineHeight: 22 }}>
                      {open ? optionLabelFor(open, item) : ""}
                    </Body>
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
