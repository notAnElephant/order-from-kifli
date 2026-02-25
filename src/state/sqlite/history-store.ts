import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type { HistoryStore, MealHistoryEntry, ProposalRecord } from '../../types.js';
import { isoDaysAgo } from '../../utils/time.js';

function serializeProposal(proposal: ProposalRecord): string {
  return JSON.stringify(proposal);
}

function deserializeProposal(json: string): ProposalRecord {
  return JSON.parse(json) as ProposalRecord;
}

export class SqliteHistoryStore implements HistoryStore {
  private db: Database.Database;
  private timezone: string;

  constructor(options: { dbPath: string; timezone: string }) {
    const dir = dirname(options.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.timezone = options.timezone;
  }

  async initialize(): Promise<void> {
    const sql = readFileSync(join(process.cwd(), 'migrations/001_init.sql'), 'utf8');
    this.db.exec(sql);
  }

  async getRecentMeals(days = 14): Promise<MealHistoryEntry[]> {
    const cutoff = isoDaysAgo(days, this.timezone);
    const rows = this.db
      .prepare(
        `SELECT p.id as proposal_id, p.created_at, p.status, r.recipe_id, r.recipe_name, r.dominant_ingredients_json
         FROM proposals p
         JOIN proposal_recipes r ON r.proposal_id = p.id
         WHERE p.created_at >= ? AND p.status IN ('approved', 'ordered')
         ORDER BY p.created_at DESC`
      )
      .all(cutoff) as Array<{
      proposal_id: string;
      created_at: string;
      status: 'approved' | 'ordered';
      recipe_id: string;
      recipe_name: string;
      dominant_ingredients_json: string;
    }>;

    return rows.map((row) => ({
      proposalId: row.proposal_id,
      plannedDate: row.created_at,
      recipeId: row.recipe_id,
      recipeName: row.recipe_name,
      dominantIngredients: JSON.parse(row.dominant_ingredients_json) as string[],
      status: row.status
    }));
  }

  async saveProposal(proposal: ProposalRecord): Promise<void> {
    const tx = this.db.transaction((record: ProposalRecord) => {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO proposals (
            id, created_at, status, period_start, period_end, summary_json,
            telegram_message_id, approved_at, rejected_at, ordered_at, order_result_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          record.createdAt,
          record.status,
          record.periodStart,
          record.periodEnd,
          serializeProposal(record),
          record.telegramMessageId ?? null,
          record.approvedAt ?? null,
          record.rejectedAt ?? null,
          record.orderedAt ?? null,
          record.orderResult ? JSON.stringify(record.orderResult) : null
        );

      this.db.prepare('DELETE FROM proposal_recipes WHERE proposal_id = ?').run(record.id);
      this.db.prepare('DELETE FROM proposal_cart_lines WHERE proposal_id = ?').run(record.id);

      const insertRecipe = this.db.prepare(
        `INSERT INTO proposal_recipes (proposal_id, recipe_id, recipe_name, dominant_ingredients_json, score)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const scored of record.candidate.recipes) {
        insertRecipe.run(
          record.id,
          scored.recipe.id,
          scored.recipe.name,
          JSON.stringify(scored.recipe.ingredients.slice(0, 5).map((i) => i.normalizedName)),
          scored.breakdown.total
        );
      }

      const insertCartLine = this.db.prepare(
        `INSERT INTO proposal_cart_lines (
          proposal_id, product_id, ingredient_name, product_name, quantity, unit,
          estimated_price, discounted_price, matched, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const line of record.candidate.cartProposal?.cartLines ?? []) {
        insertCartLine.run(
          record.id,
          line.productId ?? null,
          line.ingredientName,
          line.productName ?? null,
          line.quantity ?? null,
          line.unit ?? null,
          line.estimatedPrice ?? null,
          line.discountedPrice ?? null,
          line.matched ? 1 : 0,
          line.notes ? JSON.stringify(line.notes) : null
        );
      }
    });

    tx(proposal);
  }

  async getProposal(proposalId: string): Promise<ProposalRecord | null> {
    const row = this.db
      .prepare('SELECT summary_json FROM proposals WHERE id = ? LIMIT 1')
      .get(proposalId) as { summary_json: string } | undefined;
    return row ? deserializeProposal(row.summary_json) : null;
  }

  private async patchProposal(proposalId: string, patch: Partial<ProposalRecord>): Promise<void> {
    const current = await this.getProposal(proposalId);
    if (!current) throw new Error(`Proposal not found: ${proposalId}`);
    const updated: ProposalRecord = { ...current, ...patch };
    await this.saveProposal(updated);
  }

  async setProposalTelegramMessageId(proposalId: string, messageId: number): Promise<void> {
    await this.patchProposal(proposalId, { telegramMessageId: messageId });
  }

  async markApproved(proposalId: string): Promise<void> {
    await this.patchProposal(proposalId, { status: 'approved', approvedAt: new Date().toISOString() });
  }

  async markRejected(proposalId: string): Promise<void> {
    await this.patchProposal(proposalId, { status: 'rejected', rejectedAt: new Date().toISOString() });
  }

  async markOrdered(proposalId: string, orderResult: unknown): Promise<void> {
    await this.patchProposal(proposalId, {
      status: 'ordered',
      orderedAt: new Date().toISOString(),
      orderResult
    });
  }
}
