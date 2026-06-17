const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".page-section");

function showSection(sectionId) {
  sections.forEach((section) => {
    const isActive = section.id === `section-${sectionId}`;
    section.classList.toggle("is-active", isActive);
    section.hidden = !isActive;
  });

  navItems.forEach((item) => {
    const isActive = item.dataset.section === sectionId;
    item.classList.toggle("is-active", isActive);
    if (isActive) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  document.title =
    sectionId === "articles"
      ? "Книги и статьи — Финансы"
      : sectionId === "fuel"
        ? "Цены на топливо — Финансы"
      : sectionId === "chat"
        ? "Chat"
        : "Калькулятор — Конвертер валют";

  if (sectionId === "articles" && typeof window.resetBooksView === "function") {
    window.resetBooksView();
  }

  if (sectionId === "chat" && typeof window.initChat === "function") {
    window.initChat();
  }

  if (sectionId === "fuel" && typeof window.refreshFuelData === "function") {
    window.refreshFuelData();
  }
}

window.goToSection = showSection;

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    showSection(item.dataset.section);
  });
});
