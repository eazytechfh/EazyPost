export type AutomaticGroupLink = {
  veiculo_id: string;
  grupo_id: string;
  user_id: string;
  programado: false;
};

export function buildAutomaticGroupLinks(
  grupos: Array<{ id: string }>,
  vehicleId: string,
  userId: string
): AutomaticGroupLink[] {
  return grupos.map((grupo) => ({
    veiculo_id: vehicleId,
    grupo_id: grupo.id,
    user_id: userId,
    programado: false
  }));
}
