import { keepPreviousData } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Badge, Card, Chip, ErrorBox, Loading, Muted, Screen, styles, Title } from "@/components/ui";
import { errorText, formatXaf, modeLabel } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { colors } from "@/theme";

const CITIES = ["Toutes les villes", "Douala", "Yaoundé", "Bafoussam"];

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("Toutes les villes");
  const [mode, setMode] = useState<"salon" | "domicile" | undefined>();
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  const results = trpc.catalog.search.useQuery({ query: debounced || undefined, city, mode }, { placeholderData: keepPreviousData });
  const categories = trpc.catalog.categories.useQuery(undefined, { staleTime: 5 * 60_000 });

  return <Screen>
    <Title eyebrow="KOFI">Trouvez votre main de confiance.</Title>
    <Muted>Tarifs affichés, vrais créneaux, au salon ou à domicile.</Muted>
    <TextInput value={query} onChangeText={setQuery} placeholder="Prestation, nom, quartier…" placeholderTextColor="#9A8B83" style={styles.input} accessibilityLabel="Rechercher" returnKeyType="search" />
    <View style={styles.wrap}>{CITIES.map((item) => <Chip key={item} label={item} selected={city === item} onPress={() => setCity(item)} />)}</View>
    <View style={styles.wrap}>
      <Chip label="Tous les modes" selected={!mode} onPress={() => setMode(undefined)} />
      <Chip label="En salon" selected={mode === "salon"} onPress={() => setMode("salon")} />
      <Chip label="À domicile" selected={mode === "domicile"} onPress={() => setMode("domicile")} />
    </View>
    {!query && !!categories.data?.length && <View style={styles.wrap}>{categories.data.slice(0, 8).map((category) => <Chip key={category} label={category} onPress={() => setQuery(category)} />)}</View>}
    {results.isLoading ? <Loading label="Recherche…" /> : results.error ? <ErrorBox message={errorText(results.error.message)} onRetry={() => results.refetch()} /> : !results.data?.length ? <Card><Text style={{ fontWeight: "800", color: colors.ink }}>Aucun résultat</Text><Muted>Essayez une autre ville ou une prestation plus large.</Muted></Card>
      : <View style={{ gap: 12 }} accessibilityLabel={`${results.data.length} professionnels`}>{results.data.map((pro) => <Pressable key={pro.slug} accessibilityRole="button" accessibilityLabel={`${pro.name}, ${pro.city}`} onPress={() => router.push(`/pro/${pro.slug}`)}>
        <Card style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: pro.accent, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: 20 }}>{pro.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</Text></View>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.row}><Text style={{ fontWeight: "800", fontSize: 16, color: colors.ink, flexShrink: 1 }}>{pro.name}</Text>{pro.verified && <Badge label="Vérifié" tone="green" />}</View>
            <Muted>{pro.salon} · {pro.neighborhood ? `${pro.neighborhood}, ` : ""}{pro.city}</Muted>
            <Text style={{ color: colors.leaf, fontWeight: "700", fontSize: 13 }}>Dès {formatXaf(Math.min(...pro.services.map((service) => service.price)))} · {modeLabel(pro.mode)}{pro.reviewCount ? ` · ★ ${pro.rating.toFixed(1)}` : " · Nouveau"}</Text>
          </View>
        </Card>
      </Pressable>)}</View>}
    <Muted style={{ fontSize: 12 }}>Catalogue de démonstration : profils et disponibilités fictifs.</Muted>
  </Screen>;
}
