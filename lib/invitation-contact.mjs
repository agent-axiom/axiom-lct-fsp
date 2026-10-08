/** Display only the existing authorized DTO; do not infer or request private data.
 * @param {{status:string,candidateContact?:string}} invitation */
export function invitationContactLabel(invitation) {
  if (invitation.candidateContact) return `Кандидат разрешил контакт: ${invitation.candidateContact}`;
  if (invitation.status === 'accepted') return 'Контакт недоступен: нет действующего согласия кандидата.';
  if (invitation.status === 'declined') return 'Контакт недоступен: приглашение отклонено.';
  return 'Контакт откроется после принятия при действующем согласии кандидата.';
}
