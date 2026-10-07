export const openApiSpec = {
  openapi: "3.0.0",
  info: {
    title: "Expense Tracker API",
    version: "1.0.0",
    description: "API for SMS transaction capture, expense tracking, accounts, and categories.",
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Ingestion token (from .dev.vars / Cloudflare secrets)",
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health Check",
        description: "Checks API status and D1 database connectivity.",
        responses: {
          200: {
            description: "Service is healthy and database is connected.",
          },
        },
      },
    },
    "/capture": {
      post: {
        summary: "Capture Transaction SMS",
        description: "Endpoint called by iOS Shortcuts to capture bank and credit card SMS messages.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["sender", "message"],
                properties: {
                  sender: {
                    type: "string",
                    example: "VK-HDFCBK",
                    description: "SMS sender identifier (e.g. VK-HDFCBK, AD-SBIINB)",
                  },
                  message: {
                    type: "string",
                    example: "Spent Rs. 1,250 on HDFC Bank Card 2537 at SWIGGY on 05-OCT-26 at 14:32:05. Avbl Lmt: 2,45,000.",
                    description: "Original raw SMS text received on phone",
                  },
                  source: {
                    type: "string",
                    example: "ashish",
                    description: "Source user or phone (e.g. ashish, wife)",
                  },
                  receivedAt: {
                    type: "string",
                    format: "date-time",
                    example: "2026-10-05T14:32:10.000Z",
                    description: "Timestamp when SMS was received on device",
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Transaction captured and stored successfully.",
          },
          200: {
            description: "Duplicate transaction or ignored OTP.",
          },
          400: {
            description: "Invalid payload (missing sender or message).",
          },
          401: {
            description: "Unauthorized (invalid or missing Bearer token).",
          },
        },
      },
    },
    "/transactions": {
      get: {
        summary: "List Transactions",
        description: "Returns the most recent captured transactions.",
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 50 },
            description: "Maximum number of transactions to return",
          },
          {
            name: "month",
            in: "query",
            required: false,
            schema: { type: "string", example: "2026-10" },
            description: "Filter by YYYY-MM",
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["PARSED", "UNPARSED", "DISCARDED"] },
            description: "Filter by transaction status",
          },
        ],
        responses: {
          200: {
            description: "Array of transactions.",
          },
        },
      },
    },
    "/transactions/summary": {
      get: {
        summary: "Transaction Summary",
        description: "Returns spending totals grouped by category or merchant.",
        parameters: [
          {
            name: "groupBy",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["category", "merchant"], default: "category" },
            description: "Group spending by category or merchant",
          },
          {
            name: "type",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["DEBIT", "CREDIT"], default: "DEBIT" },
            description: "Filter transaction type",
          },
          {
            name: "from",
            in: "query",
            required: false,
            schema: { type: "string", example: "2026-10-01" },
            description: "Start date filter",
          },
          {
            name: "to",
            in: "query",
            required: false,
            schema: { type: "string", example: "2026-10-31" },
            description: "End date filter",
          },
        ],
        responses: {
          200: {
            description: "Aggregated spending summary array.",
          },
        },
      },
    },
    "/transactions/reprocess": {
      post: {
        summary: "Reprocess Unparsed Transactions",
        description: "Re-runs parser and account linking over unparsed transactions by ID or in safe batches.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Optional specific transaction ID to reprocess",
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", default: 10, maximum: 25 },
            description: "Maximum unparsed transactions to process in batch",
          },
        ],
        responses: {
          200: {
            description: "Reprocessing results summary.",
          },
        },
      },
    },
    "/accounts": {
      get: {
        summary: "List Accounts & Cards",
        description: "Returns all credit cards and bank accounts.",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["ACTIVE", "ARCHIVED", "EXPIRED", "REPLACED"] },
            description: "Filter accounts by status",
          },
        ],
        responses: {
          200: {
            description: "Array of accounts.",
          },
        },
      },
    },
    "/categories": {
      get: {
        summary: "List Categories",
        description: "Returns flat list of expense categories.",
        responses: {
          200: {
            description: "Array of active categories.",
          },
        },
      },
    },
  },
};
