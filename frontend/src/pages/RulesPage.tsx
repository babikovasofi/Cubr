// Публичная страница правил (Этап 6): читается ДО регистрации, без состояния.
//
// Локализация (проход 3): длинная проза разведена по языковым файлам, а не по
// словарю строк. Причина: при пофразовом переводе один пропущенный ключ делает
// абзац двуязычным, а править надо целыми абзацами. Цена — два файла держим
// синхронно; для правил и приватности это и так обязательное требование.

import { useLangStore } from "../store/langStore";
import RulesRu from "./legal/RulesRu";
import RulesEn from "./legal/RulesEn";

export default function RulesPage() {
  const lang = useLangStore((s) => s.lang);
  return lang === "en" ? <RulesEn /> : <RulesRu />;
}
