// Ловит падение при загрузке ленивого чанка роута.
//
// Экраны ритуала грузятся отдельными файлами (см. App.tsx). У этого есть режим
// отказа, которого не было, пока всё лежало в одном бандле: файл не доехал.
// Причины бытовые — моргнула сеть, или мы выкатили новую версию, пока вкладка
// была открыта, и старые имена чанков с хешами больше не существуют.
//
// React в таком случае снимает всё поддерево. Без границы человек получает
// белый экран без единого слова — и решает, что сайт умер. Граница говорит, что
// произошло, и предлагает единственное, что реально чинит: перезагрузку (она
// заодно подтянет новую версию).

import { Component, type ErrorInfo, type ReactNode } from "react";
import Button from "./Button";
import { translate } from "../i18n/t";
import { useLangStore } from "../store/langStore";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

function FailPanel() {
  // Хук здесь, а не в классе: граница обязана быть классом, но текст всё равно
  // должен слушаться переключателя языка.
  const lang = useLangStore((s) => s.lang);
  const t = (key: string) => translate(lang, key);

  return (
    <div className="flex min-h-[40vh] flex-col items-start justify-center gap-4">
      <p role="alert" className="max-w-prose font-sans text-body text-ink">
        {t("Не удалось загрузить эту страницу — похоже, оборвалась связь или вышла новая версия.")}
      </p>
      <Button onClick={() => window.location.reload()}>{t("Обновить страницу")}</Button>
    </div>
  );
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Консоль — единственный получатель: сторонней аналитики в проекте нет
    // (обещано на странице приватности), а молча глотать ошибку нельзя.
    console.error("route chunk failed to load", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? <FailPanel /> : this.props.children;
  }
}
