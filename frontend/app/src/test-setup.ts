// Vitest setup: register jest-dom matchers (toBeInTheDocument, etc.) for the
// component specs that render via @testing-library/react under jsdom.
import "@testing-library/jest-dom/vitest";
// Initialize i18next once (synchronous, bundled catalogs) so components rendered
// WITHOUT an <I18nextProvider> — as the component specs do — still resolve real
// copy via useTranslation() instead of raw keys.
import "./i18n";
