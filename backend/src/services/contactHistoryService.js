import { getDatabaseRuntime } from "../database/runtime.js";
import { listAdminUsersRows } from "../database/repositories/coreRepository.js";
import {
  ACTION_TYPES_BY_BOARD,
  CONTACT_HISTORY_ACTIONS,
  CONTACT_HISTORY_TIME_ZONE as TIME_ZONE,
  normalizeContactHistoryFilters,
  normalizeContactHistoryRow,
  summarizeContactHistory
} from "../domain/contactHistory.js";

// Historico de contatos da tela Vacinas, lido do audit_logs (ver domain/contactHistory.js).
export async function getContactHistoryCore(query = {}) {
  const filters = normalizeContactHistoryFilters(query);
  const actionTypes = filters.type ? ACTION_TYPES_BY_BOARD[filters.type] : Object.keys(CONTACT_HISTORY_ACTIONS);
  const params = [actionTypes, filters.from, filters.to];
  let where = `
    a.action_type = ANY($1::text[])
    AND (a.created_at::timestamptz AT TIME ZONE '${TIME_ZONE}')::date BETWEEN $2::date AND $3::date
  `;
  if (filters.actorUserId !== null) {
    params.push(filters.actorUserId);
    where += ` AND a.actor_user_id = $${params.length}`;
  }

  const runtime = await getDatabaseRuntime();
  const selectSql = `
    SELECT
      a.id,
      a.action_type AS "actionType",
      a.actor_user_id AS "actorUserId",
      u.name AS "actorName",
      a.patient_id AS "patientId",
      p.name AS "currentPatientName",
      a.description,
      a.details_json AS "detailsJson",
      a.created_at AS "createdAt",
      to_char(a.created_at::timestamptz AT TIME ZONE '${TIME_ZONE}', 'DD/MM/YYYY HH24:MI') AS "createdAtLabel"
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN patients p ON p.id = a.patient_id
    WHERE ${where}
    ORDER BY a.created_at DESC, a.id DESC
  `;

  const [pageResult, allResult, actors] = await Promise.all([
    runtime.query(`${selectSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [
      ...params,
      filters.pageSize,
      (filters.page - 1) * filters.pageSize
    ]),
    // Resumo e total usam todas as linhas do periodo filtrado (sem paginacao).
    runtime.query(selectSql, params),
    listAdminUsersRows()
  ]);

  const allRows = allResult.rows.map(normalizeContactHistoryRow);
  return {
    filters: { from: filters.from, to: filters.to, actorUserId: filters.actorUserId, type: filters.type },
    page: filters.page,
    pageSize: filters.pageSize,
    total: allRows.length,
    totalPages: Math.max(1, Math.ceil(allRows.length / filters.pageSize)),
    rows: pageResult.rows.map(normalizeContactHistoryRow),
    summary: summarizeContactHistory(allRows),
    actors: actors.map((user) => ({ id: user.id, name: user.name, role: user.role, active: Boolean(user.active) }))
  };
}
