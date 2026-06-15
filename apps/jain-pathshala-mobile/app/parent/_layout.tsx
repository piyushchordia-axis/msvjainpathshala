import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={["parent"]}
      tabs={[
        { name: "home", title: hi ? "मुख" : "Home", icon: "home" },
        { name: "children", title: hi ? "बच्चे" : "Children", icon: "people" },
        { name: "niyams", title: hi ? "नियम" : "Niyams", icon: "sparkles" },
        { name: "library", title: hi ? "पुस्तकालय" : "Library", icon: "library" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
