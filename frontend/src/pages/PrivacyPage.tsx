// Публичная политика конфиденциальности (Этап 6).
//
// Правило текста: перечисляем то, что код РЕАЛЬНО делает на дату «обновлено».
// Кадры с камеры сейчас на сервер не уходят вовсе — так и написано; когда
// появится честностный кирпич (кадры-доказательства), ОБЕ языковые версии
// правятся в том же коммите, что и включение отправки.

import { useLangStore } from "../store/langStore";
import PrivacyRu from "./legal/PrivacyRu";
import PrivacyEn from "./legal/PrivacyEn";

export default function PrivacyPage() {
  const lang = useLangStore((s) => s.lang);
  return lang === "en" ? <PrivacyEn /> : <PrivacyRu />;
}
