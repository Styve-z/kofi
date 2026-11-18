import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
// Import de type uniquement : l’app partage les contrats du serveur sans embarquer son code.
import type { AppRouter } from "../../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();
export type Outputs = inferRouterOutputs<AppRouter>;
export type Professional = Outputs["catalog"]["search"][number];
export type Service = Professional["services"][number];
export type Booking = Outputs["booking"]["mine"][number];
export type BookingStatus = Booking["status"];
