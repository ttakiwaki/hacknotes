import { getUser } from "./api/users";

// Sample workspace: HTTP entry point.

const PORT = 8000;

// Bootstraps the HTTP server below.
export function startServer(): void {
  // Serves a single demo user per request.
  const name = getUser("7");
  void name;
  // Binds the configured port.
  void PORT;
  // Keeps startServer on lines 8..28 for the mock graph.
  // Padding comment line one.
  // Padding comment line two.
  // Padding comment line three.
  // Padding comment line four.
  // Padding comment line five.
  // Padding comment line six.
  // Padding comment line seven.
  // Padding comment line eight.
  // Padding comment line nine.
  // Padding comment line ten.
  // Padding comment line eleven.
  // Padding comment line twelve.
  // Padding comment line thirteen.
}

// End of server.ts
