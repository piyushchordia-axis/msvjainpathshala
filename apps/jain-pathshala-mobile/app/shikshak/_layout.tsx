import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={["shikshak"]}
      hide={[
        "niyams",
        "niyam-review",
        "punya",
        "courses",
        "course/[id]",
        "join-approvals",
        // Reached from Quick actions, like the rest of these — the tab bar is
        // the daily five, not everything a Guruji can do (H17).
        "quizzes",
      ]}
      tabs={[
        { name: "today", title: hi ? "डैशबोर्ड" : "Dashboard", icon: "home" },
        { name: "students", title: hi ? "विद्यार्थी" : "Students", icon: "people" },
        { name: "batches", title: hi ? "बैच" : "Batches", icon: "grid" },
        { name: "homework", title: hi ? "गृहकार्य" : "Homework", icon: "book" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
