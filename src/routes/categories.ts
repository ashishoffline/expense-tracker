import { Hono } from "hono";
import type { Env } from "../types";

export const categoriesRoute = new Hono<{ Bindings: Env }>();

categoriesRoute.get("/", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM categories ORDER BY name ASC"
    ).all();

    return c.json(results);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch categories",
      },
      500
    );
  }
});

