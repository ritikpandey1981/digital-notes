import { Button } from "@folio/ui";
import appIconUrl from "../../../assets/app-icon.svg";

export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-folio-workspace px-6 text-folio-ink">
      <section className="flex max-w-md flex-col items-center text-center">
        <img className="mb-6 size-20" src={appIconUrl} alt="Folio" />
        <h1 className="text-4xl font-semibold tracking-tight">Folio</h1>
        <p className="mt-3 text-base leading-7 text-folio-muted">Write beautifully.</p>
        <Button className="mt-8" disabled>
          Foundation ready
        </Button>
      </section>
    </main>
  );
}
