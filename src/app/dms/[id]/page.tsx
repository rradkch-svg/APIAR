import { PERSONA_SEEDS } from "@/lib/personas/metadata";
import DmThreadClient from "./DmThreadClient";

export function generateStaticParams() {
  return PERSONA_SEEDS.map((p) => ({ id: p.id }));
}

export default function DmThreadPage() {
  return <DmThreadClient />;
}
