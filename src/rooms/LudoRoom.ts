import { Client, Room } from "@colyseus/core";
import { config } from "../config";
import { LudoState } from "./LudoState";

export class LudoRoom extends Room<LudoState> {
  maxClients = config.maxPlayersPerRoom;

  onCreate(): void {
    this.setState(new LudoState());

    // The client never sends a dice value; the server rolls it.
    this.onMessage("roll", (client) => {
      // TODO: check it is this client's turn, then roll with a server-side CSPRNG.
      console.log(`roll requested by ${client.sessionId}`);
    });

    this.onMessage("move", (client, message) => {
      // TODO: validate the move against the rules engine, then apply it.
      console.log(`move requested by ${client.sessionId}`, message);
    });
  }

  onJoin(client: Client): void {
    // TODO: enforce the 3-active-games limit (Redis set per user) before seating.
    console.log(`${client.sessionId} joined`);
  }

  onLeave(client: Client): void {
    // TODO: allow reconnect, then hand the seat to a bot after the timeout.
    console.log(`${client.sessionId} left`);
  }
}
