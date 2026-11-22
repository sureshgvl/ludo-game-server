import { config } from "./config";
import { createGameServer } from "./server";

const { gameServer } = createGameServer();

gameServer.listen(config.port).then(() => {
  console.log(`ludo-game-server listening on :${config.port}`);
});
