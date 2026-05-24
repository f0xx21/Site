const articlesSubsections = document.getElementById("articlesSubsections");
const pdfViewer = document.getElementById("pdfViewer");
const epubViewer = document.getElementById("epubViewer");
const pdfFrame = document.getElementById("pdfFrame");
const pdfViewerTitle = document.getElementById("pdfViewerTitle");
const epubViewerTitle = document.getElementById("epubViewerTitle");
const epubArea = document.getElementById("epubArea");
const pdfBackBtn = document.getElementById("pdfBackBtn");
const epubBackBtn = document.getElementById("epubBackBtn");
const epubPrevBtn = document.getElementById("epubPrevBtn");
const epubNextBtn = document.getElementById("epubNextBtn");
const pdfOpenTab = document.getElementById("pdfOpenTab");
const epubOpenTab = document.getElementById("epubOpenTab");
const subsectionItems = document.querySelectorAll(".subsection-item");
const seriesBackBtns = document.querySelectorAll(".js-series-back");
const bookItems = document.querySelectorAll(".book-item");
const allSeries = document.querySelectorAll(".books-series");

let activeSeries = null;
let activeSeriesTitle = "";
let currentEpub = null;
let currentRendition = null;

function setReaderVisible(type) {
  const showPdf = type === "pdf";
  const showEpub = type === "epub";

  pdfViewer.hidden = !showPdf;
  pdfViewer.classList.toggle("is-hidden", !showPdf);
  epubViewer.hidden = !showEpub;
  epubViewer.classList.toggle("is-hidden", !showEpub);

  if (!showPdf) {
    pdfFrame.removeAttribute("src");
    pdfFrame.src = "";
  }
  if (!showEpub) {
    destroyEpub();
  }
}

function hideAllSeries() {
  allSeries.forEach((el) => {
    el.hidden = true;
  });
}

function destroyEpub() {
  if (currentRendition) {
    currentRendition.destroy();
    currentRendition = null;
  }
  if (currentEpub) {
    currentEpub.destroy();
    currentEpub = null;
  }
  epubArea.innerHTML = "";
}

function loadEpubBuffer(path) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", path, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 0) {
        resolve(xhr.response);
      } else {
        reject(new Error(`Ошибка загрузки (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.send();
  });
}

function showEpubLoadError(epubPath, detail) {
  const isFileProtocol = window.location.protocol === "file:";
  epubArea.innerHTML = `
    <p class="epub-error">
      Не удалось открыть книгу${detail ? `: ${detail}` : ""}.
      ${
        isFileProtocol
          ? `<br><br>Запустите <strong>start-server.bat</strong> и откройте <code>http://localhost:3000</code>`
          : "<br><br>Проверьте наличие файла в папке books/."
      }
      <br><br><a href="${epubPath}" download>Скачать EPUB</a>
    </p>
  `;
}

function showSubsections() {
  articlesSubsections.hidden = false;
  hideAllSeries();
  setReaderVisible(null);
  pdfOpenTab.href = "#";
  epubOpenTab.href = "#";
  activeSeries = null;
  activeSeriesTitle = "";
  document.title = "Книги и статьи — Финансы";
}

function openSubsection(button) {
  const seriesEl = document.getElementById(button.dataset.series);
  if (!seriesEl) return;

  activeSeries = seriesEl;
  activeSeriesTitle = button.dataset.title || "Книги и статьи";
  articlesSubsections.hidden = true;
  hideAllSeries();
  seriesEl.hidden = false;
  setReaderVisible(null);
  document.title = `${activeSeriesTitle} — Книги и статьи`;
}

function openPdf(pdfPath, title) {
  const seriesId = activeSeries?.id;
  if (activeSeries) activeSeries.hidden = true;
  setReaderVisible("pdf");
  pdfViewerTitle.textContent = title;
  pdfFrame.src = pdfPath;
  pdfOpenTab.href = pdfPath;
  pdfBackBtn.textContent =
    seriesId === "booksSeriesSociology" ? "← К томам" : "← К книгам";
  document.title = `${title} — Книги и статьи`;
}

async function openEpub(epubPath, title) {
  if (activeSeries) activeSeries.hidden = true;
  setReaderVisible("epub");
  epubViewerTitle.textContent = title;
  epubOpenTab.href = epubPath;
  document.title = `${title} — Книги и статьи`;

  destroyEpub();
  epubArea.innerHTML = '<p class="epub-loading">Загрузка книги…</p>';

  try {
    const buffer = await loadEpubBuffer(epubPath);
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("пустой файл");
    }

    epubArea.innerHTML = "";
    currentEpub = ePub();
    await currentEpub.open(buffer, "binary");
    currentRendition = currentEpub.renderTo(epubArea, {
      width: "100%",
      height: "65vh",
      flow: "paginated",
    });
    await currentRendition.display();
  } catch (err) {
    const detail =
      err.message === "network"
        ? "нет доступа к файлу"
        : err.message || "неизвестная ошибка";
    showEpubLoadError(epubPath, detail);
  }
}

function closePdf() {
  setReaderVisible(null);
  pdfOpenTab.href = "#";
  if (activeSeries) activeSeries.hidden = false;
  document.title = `${activeSeriesTitle} — Книги и статьи`;
}

function closeEpub() {
  setReaderVisible(null);
  epubOpenTab.href = "#";
  if (activeSeries) activeSeries.hidden = false;
  document.title = `${activeSeriesTitle} — Книги и статьи`;
}

subsectionItems.forEach((button) => {
  button.addEventListener("click", () => openSubsection(button));
});

seriesBackBtns.forEach((btn) => {
  btn.addEventListener("click", showSubsections);
});

bookItems.forEach((button) => {
  button.addEventListener("click", () => {
    const title = button.dataset.title;
    if (button.dataset.epub) {
      openEpub(button.dataset.epub, title);
    } else if (button.dataset.pdf) {
      openPdf(button.dataset.pdf, title);
    }
  });
});

pdfBackBtn.addEventListener("click", closePdf);
epubBackBtn.addEventListener("click", closeEpub);

epubPrevBtn.addEventListener("click", () => {
  if (currentRendition) currentRendition.prev();
});

epubNextBtn.addEventListener("click", () => {
  if (currentRendition) currentRendition.next();
});

setReaderVisible(null);
window.resetBooksView = showSubsections;
