import { Redirect } from "expo-router";

/** Notices feed lives in the inbox hub (`/notifications?tab=notices`). */
export default function NoticesScreen() {
  return <Redirect href={"/notifications?tab=notices" as never} />;
}
