/** The PAPER rail: the venue rail over the account's own paper account (live/paper.ts, or a venue's test environment). A test token only:
 * its money is paper, its rows say so (paper: true), and nothing of it is in the net worth. See rails/venue.ts for what a use is */
import type { AccountEngine } from "../exchange.ts";
import type { TokenRail } from "./index.ts";
import { venueRail } from "./venue.ts";

export const paperRail = (e: AccountEngine): TokenRail => venueRail(e, "paper");
