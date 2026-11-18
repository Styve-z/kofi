import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius } from "@/theme";

export function Screen({ children, scroll = true, edges = ["top"] }: { children: ReactNode; scroll?: boolean; edges?: ("top" | "bottom")[] }) {
  return <SafeAreaView style={styles.safe} edges={edges}>{scroll ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={styles.content}>{children}</View>}</SafeAreaView>;
}

export function Title({ children, eyebrow }: { children: ReactNode; eyebrow?: string }) {
  return <View style={{ gap: 4 }}>{eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}<Text style={styles.title} accessibilityRole="header">{children}</Text></View>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ label, onPress, variant = "primary", disabled, loading, accessibilityLabel }: { label: string; onPress: () => void; variant?: "primary" | "outline" | "danger" | "ghost"; disabled?: boolean; loading?: boolean; accessibilityLabel?: string }) {
  const palette = { primary: [colors.mandarin, "#FFFFFF", colors.mandarin], outline: [colors.card, colors.ink, "#D9CABE"], danger: [colors.card, colors.danger, "#E2B8AF"], ghost: ["transparent", colors.muted, "transparent"] }[variant];
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: disabled || loading }} disabled={disabled || loading} onPress={onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: palette[0], borderColor: palette[2], opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
    {loading ? <ActivityIndicator color={palette[1]} /> : <Text style={[styles.buttonText, { color: palette[1] }]}>{label}</Text>}
  </Pressable>;
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipOn]}><Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text></Pressable>;
}

export function Badge({ label, tone }: { label: string; tone: "orange" | "green" | "gray" }) {
  const palette = { orange: [colors.warnSoft, colors.warn], green: [colors.leafSoft, colors.leaf], gray: ["#EEE7DD", colors.muted] }[tone];
  return <View style={[styles.badge, { backgroundColor: palette[0] }]}><Text style={[styles.badgeText, { color: palette[1] }]}>{label}</Text></View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 6 }}><Text style={styles.label}>{label}</Text><TextInput placeholderTextColor="#9A8B83" style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: "top" }]} accessibilityLabel={label} {...props} /></View>;
}

export function Loading({ label = "Chargement…" }: { label?: string }) {
  return <View style={styles.center} accessibilityLiveRegion="polite"><ActivityIndicator color={colors.mandarin} /><Muted>{label}</Muted></View>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <View style={styles.error} accessibilityRole="alert"><Text style={styles.errorText}>{message}</Text>{onRetry && <Pressable accessibilityRole="button" onPress={onRetry}><Text style={styles.link}>Réessayer</Text></Pressable>}</View>;
}

export function Stars({ value }: { value: number }) {
  return <Text style={{ color: "#E0952F", fontSize: 15 }} accessibilityLabel={`${value} sur 5`}>{"★".repeat(value)}{"☆".repeat(5 - value)}</Text>;
}

export function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Votre note">{[1, 2, 3, 4, 5].map((star) => <Pressable key={star} accessibilityRole="radio" accessibilityState={{ checked: value === star }} accessibilityLabel={`${star} étoile${star > 1 ? "s" : ""}`} onPress={() => onChange(star)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 30, color: star <= value ? "#E0952F" : "#C9B9AC" }}>{star <= value ? "★" : "☆"}</Text></Pressable>)}</View>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <View style={styles.notice}><Text style={styles.noticeText}>{children}</Text></View>;
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.sand },
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  eyebrow: { color: colors.leaf, fontWeight: "800", letterSpacing: 1.5, fontSize: 12, textTransform: "uppercase" },
  title: { color: colors.ink, fontSize: 30, lineHeight: 34, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 8 },
  button: { minHeight: 48, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 15, fontWeight: "800" },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: "#D9CABE", backgroundColor: colors.card, justifyContent: "center" },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { color: colors.ink, fontWeight: "700", fontSize: 14 },
  chipTextOn: { color: "#FFFDF9" },
  badge: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontWeight: "800" },
  label: { color: colors.muted, fontWeight: "800", fontSize: 13 },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#DFD1C5", borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, color: colors.ink, fontSize: 16 },
  center: { alignItems: "center", gap: 8, padding: 30 },
  error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, gap: 6 },
  errorText: { color: colors.danger, fontWeight: "700" },
  link: { color: colors.mandarinDark, fontWeight: "800" },
  notice: { backgroundColor: "#FFF1E9", borderRadius: radius.md, padding: 12 },
  noticeText: { color: "#9A4F2D", fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
