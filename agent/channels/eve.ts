import { type AuthFn, httpBasic, localDev } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * Secret minted by the CLI for one invocation and passed to the server it
 * spawns. The server listens on loopback, but binding the route to a per-run
 * credential keeps another local process from driving the agent.
 */
const token = process.env.PRCRAFT_TOKEN;

const auth: AuthFn<Request>[] = [
  // Keeps `eve dev` and its REPL working for local development.
  localDev(),
];

if (token) {
  auth.push(httpBasic({ username: "pr-craft", password: token }));
}

// With neither entry matching, the walk ends in a 401: this agent has no
// anonymous access and is never meant to be deployed publicly.
export default eveChannel({ auth });
