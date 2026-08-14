import { Stack } from "expo-router";

/** Nested stack so Course → Section keeps a back history. */
export default function CourseIdLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="section/[sectionId]" />
    </Stack>
  );
}
