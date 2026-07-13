import dotenv from "dotenv";
import app from "./app";

dotenv.config();

const port = Number(process.env.PORT ?? 5001);

app.listen(port, () => {
  console.log(`Katana Sushi API running on http://localhost:${port}`);
});
