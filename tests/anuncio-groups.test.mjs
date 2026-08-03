import assert from "node:assert/strict";
import test from "node:test";

test("cria um vinculo automatico para cada grupo valido", async () => {
  let buildAutomaticGroupLinks;

  try {
    ({ buildAutomaticGroupLinks } = await import("../lib/anuncio-groups.ts"));
  } catch {
    assert.fail("O criador de vinculos automaticos ainda nao existe");
  }

  const links = buildAutomaticGroupLinks(
    [{ id: "grupo-1" }, { id: "grupo-2" }],
    "veiculo-1",
    "usuario-1"
  );

  assert.deepEqual(links, [
    {
      veiculo_id: "veiculo-1",
      grupo_id: "grupo-1",
      user_id: "usuario-1",
      programado: false
    },
    {
      veiculo_id: "veiculo-1",
      grupo_id: "grupo-2",
      user_id: "usuario-1",
      programado: false
    }
  ]);
});
