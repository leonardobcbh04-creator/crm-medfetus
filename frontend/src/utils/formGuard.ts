// Guarda simples e leve para avisar sobre alteracoes nao salvas em formularios.
// Usado em conjunto com o listener de beforeunload (fechar aba/atualizar pagina)
// e com a interceptacao de cliques de navegacao dentro do proprio app (menu lateral, links de "voltar").
let dirty = false;

const DEFAULT_MESSAGE = "Voce tem alteracoes nao salvas. Deseja realmente sair sem salvar?";

export function setFormDirty(value: boolean) {
  dirty = value;
}

export function isFormDirty() {
  return dirty;
}

export function confirmDiscardChanges(message = DEFAULT_MESSAGE): boolean {
  if (!dirty) {
    return true;
  }
  const confirmed = window.confirm(message);
  if (confirmed) {
    dirty = false;
  }
  return confirmed;
}
