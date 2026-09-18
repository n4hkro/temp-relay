// "Bu sayt" — sabit saytı olmayan relay deskriptoru.
//
// Adi relay-in url-i, hostları və silmə planı deskriptordadır; bu isə AKTİV TABIN saytını
// mənimsəyir: Başlat basılanda hansı tabda dayanmışsansa, aktivasiya kodu həmin sayt üçün
// axtarılır. Beləliklə extension yalnız qoşulu relay saytlarına deyil, istənilən sayta
// (facebook.com, github.com…) qeydiyyat üçün işləyir.
//
// Sayt məlumatı işləmə anında bilindiyi üçün burada url/hosts/cleanup/mail/signup YOXDUR —
// kontrakt onların yazılmasını qadağan edir (bax: providers/contract.js → validateRelay).
// Onları `background/relay.js → resolveRelay()` tabın URL-indən törədir:
//   • poçt ipuçları — saytın qeydə alınabilən domeni və onun tokenləri
//   • silmə planı   — shared/cleanup.js → tabCleanupPlan()
//
// Fərqlər (qəsdəndir):
//   • heç bir tab AÇILMIR — istifadəçinin öz tabı işlədilir;
//   • forma DƏQİQ ADDIMLARLA doldurulmur: sayt naməlumdur, selektor yoxdur. Onun yerinə
//     evristika işləyir (bax: background/forms.js) — qeydiyyat forması açılır, bütün tanınan
//     xanalar uzlaşan şəxs profili ilə doldurulur, razılıq xanaları işarələnir və qeydiyyat
//     düyməsi basılır;
//   • tab bağlananda sayt məlumatı SİLİNMİR və tab yenidən açılmır — istifadəçinin öz
//     saytıdır, silmək istəsə alət cərgəsindəki 🗑 düyməsi var.
export default {
  id: "active-tab",
  name: "bu sayt (aktiv tab)",
  adoptActiveTab: true,
};
