// Minimal Linear GraphQL client used by the feedback endpoints to file
// user-submitted issues into the User Feedback team.
//
// IDs captured 2026-05-22 from the Viktorious LLC workspace. If a label is
// renamed or the team is restructured, refresh via:
//   mcp__linear-server__list_issue_labels({ team: "User Feedback" })
//   mcp__linear-server__list_issue_statuses({ team: "..." })

const LINEAR_API_URL = "https://api.linear.app/graphql";

export const USER_FEEDBACK_TEAM_ID = "5b97bb71-ccd2-4ed3-8bb0-d6e28bf3f6c1";

// Inbox column. Linear's "backlog" type maps to the team's default new-arrival
// state (Vik plans to rename the displayed status from "Backlog" -> "Inbox" in
// Linear settings; the ID stays the same).
export const INBOX_STATE_ID = "01c6e00d-c32f-481c-b5d7-d3e518aa493d";

export const TYPE_LABELS = {
  "bug-report": "abf494e1-4fd3-4567-942e-e5cd711a197f",
  "feature-request": "b7533d06-ae83-48c0-88a0-8c41060756fb",
  "ux-confusion": "35ffc9a9-b86e-4ee1-bceb-75874799564b",
  "praise": "29a697d5-2508-43ab-869d-e8ccfde727e0",
  "scraper-issue": "04489b48-922e-4e48-b63a-e954b13bc844",
  "onboarding": "8501aadd-6d44-4d98-9ca2-d826d9cb473d",
} as const;

export const SOURCE_LABELS = {
  "in-app": "369e2d63-3563-4b9e-ac58-6f687dd5958f",
  "survey": "88e3e6ae-b1f6-4275-aa9e-9505d0cce0b8",
  "linkedin-dm": "75e49ad3-17cb-4289-a428-e18df56f4df5",
  "email": "06b38e78-c36c-4a3c-bbf0-f40f5c429312",
} as const;

export type TypeLabel = keyof typeof TYPE_LABELS;
export type SourceLabel = keyof typeof SOURCE_LABELS;

export interface CreateIssueInput {
  title: string;
  description: string;
  typeLabel?: TypeLabel;
  sourceLabel: SourceLabel;
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
}

export async function createUserFeedbackIssue(
  input: CreateIssueInput,
): Promise<CreatedIssue | null> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    // Boot-time misconfiguration. Caller falls back to email-only delivery.
    console.warn("[linear] LINEAR_API_KEY not set — skipping issue creation");
    return null;
  }

  const labelIds: string[] = [SOURCE_LABELS[input.sourceLabel]];
  if (input.typeLabel) {
    labelIds.push(TYPE_LABELS[input.typeLabel]);
  }

  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }
  `;

  const variables = {
    input: {
      teamId: USER_FEEDBACK_TEAM_ID,
      stateId: INBOX_STATE_ID,
      title: input.title.slice(0, 255),
      description: input.description,
      labelIds,
    },
  };

  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    data?: { issueCreate?: { success: boolean; issue: CreatedIssue } };
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    throw new Error(`Linear GraphQL error: ${body.errors.map(e => e.message).join("; ")}`);
  }
  if (!body.data?.issueCreate?.success || !body.data.issueCreate.issue) {
    throw new Error("Linear issueCreate returned success=false");
  }
  return body.data.issueCreate.issue;
}
