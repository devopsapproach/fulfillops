import { createApp } from "./app.js";
import { apiConfig } from "../shared/config.js";

const app = createApp();

app.listen(apiConfig.PORT, () => {
  console.info(`API listening on port ${apiConfig.PORT}`);
});
