export const SERVICE_FEE = 5000;
export const DEFAULT_VISIT_DATE = "2026-12-26";
export const TMII_COORDINATES = { lat: -6.30167, lng: 106.89667 };

export const IMAGES = {
  hero: "assets/danau-archipelago.jpg",
  about: "assets/tentang-utama.jpg",
};

export const TICKETS = [
  {
    id: "paket-keluarga",
    color: "kunyit",
    name: "Paket Paspor Keluarga",
    description:
      "Tiket masuk dan semua wahana untuk sampai 2 dewasa dan 2 anak per paket, cukup satu QR untuk sekeluarga. Rombongan lebih besar dari itu? Tambah jumlah paketnya di halaman pemesanan.",
    price: 199000,
    unit: "paket",
    capacityAdults: 2,
    capacityChildren: 2,
    category: "paket",
    layout: "flagship",
    image: "assets/istana-anak.jpg",
    imageAlt: "Istana Anak-Anak Indonesia di TMII",
    width: 960,
    height: 720,
  },
  {
    id: "tiket-masuk",
    color: "daun",
    name: "Tiket Masuk Gerbang",
    description:
      "Wajib untuk semua pengunjung. Dari gerbang, kamu bebas berjalan ke area anjungan dan taman di seluruh kawasan.",
    price: 25000,
    unit: "orang",
    perPerson: true,
    category: "wajib",
    layout: "large",
    image: "assets/gerbang.jpg",
    imageAlt: "Gerbang utama Taman Mini Indonesia Indah",
    width: 1024,
    height: 1365,
  },
  {
    id: "anjungan",
    color: "bata",
    name: "Anjungan Daerah",
    description:
      "Rumah adat dari berbagai provinsi, masing-masing dengan pakaian, alat musik, dan kerajinan daerahnya.",
    price: 15000,
    unit: "orang",
    perPerson: true,
    category: "budaya",
    layout: "side",
    image: "assets/anjungan-tongkonan.jpg",
    imageAlt: "Deretan rumah Tongkonan di Anjungan Sulawesi Selatan TMII",
    width: 870,
    height: 580,
  },
  {
    id: "museum-indonesia",
    color: "nila",
    name: "Museum Indonesia",
    description: "Koleksi budaya dari berbagai daerah di satu gedung.",
    price: 20000,
    unit: "orang",
    perPerson: true,
    category: "budaya",
    layout: "row",
    image: "assets/museum-indonesia.jpg",
    imageAlt: "Gedung Museum Indonesia di TMII",
    width: 1280,
    height: 720,
  },
  {
    id: "kereta-gantung",
    color: "tosca",
    name: "Kereta Gantung",
    description: "Melihat danau dan anjungan TMII dari kabin di atas.",
    price: 50000,
    unit: "orang",
    perPerson: true,
    category: "wahana",
    layout: "row",
    image: "assets/kereta-gantung.jpg",
    imageAlt: "Kabin kereta gantung di atas Danau Archipelago TMII",
    width: 1200,
    height: 800,
  },
  {
    id: "teater-keong-mas",
    color: "anggrek",
    name: "Teater IMAX Keong Mas",
    description: "Film budaya di layar raksasa berbentuk keong emas.",
    price: 35000,
    unit: "orang",
    perPerson: true,
    category: "wahana",
    layout: "row",
    image: "assets/keong-mas.jpg",
    imageAlt: "Teater IMAX Keong Mas di TMII",
    width: 1280,
    height: 720,
  },
];

export const STEPS = [
  {
    title: "Pilih tiket dan tanggal",
    text: "Kamu tentukan sendiri wahana mana yang mau dimasukkan.",
  },
  {
    title: "Isi data pemesan",
    text: "Cukup nama, nomor WhatsApp, dan email. Tidak perlu buat akun.",
  },
  { title: "Bayar", text: "QRIS, dompet digital, atau transfer bank." },
  {
    title: "Scan di gerbang",
    text: "E-tiket berisi QR dikirim ke WhatsApp dan email kamu.",
  },
];

export const GALLERY = [
  { title: "Danau Archipelago", image: IMAGES.hero },
  { title: "Rumah Gadang, Anjungan Sumatera Barat", image: IMAGES.about },
  {
    title: "Rumah Adat di Anjungan Aceh",
    image: "assets/anjungan-aceh.jpg",
  },
  {
    title: "Istana Anak-Anak Indonesia",
    image: "assets/istana-anak.jpg",
  },
  {
    title: "Rumah Tongkonan, Anjungan Sulawesi Selatan",
    image: "assets/rumah-tongkonan.jpg",
  },
  {
    title: "Tirta Cerita di Danau Archipelago",
    image: "assets/tirta-cerita.jpg",
  },
];

export const WAHANA = [
  {
    name: "Kereta Gantung",
    label: "Wahana",
    color: "tosca",
    text: "Kabin gantung yang melintasi kawasan. Dari atas terlihat Danau Archipelago dan deretan anjungan di bawahnya.",
    ticketId: "kereta-gantung",
    detail:
      "Kereta gantung, yang di kawasan ini dikenal juga sebagai Skylift, membawa pengunjung melintasi TMII di kabin tertutup. Rutenya melewati atas Danau Archipelago, jadi dari kabin terlihat peta kepulauan Indonesia di danau itu beserta anjungan-anjungan di sekelilingnya. Ini cara paling cepat mendapat gambaran seluruh kawasan sebelum menjelajah dengan berjalan kaki.",
    image: "assets/kereta-gantung.jpg",
    width: 1200,
    height: 800,
  },
  {
    name: "Teater IMAX Keong Mas",
    label: "Wahana",
    color: "anggrek",
    text: "Teater berbentuk keong emas dengan layar IMAX, memutar film budaya dan alam Indonesia.",
    ticketId: "teater-keong-mas",
    detail:
      "Bangunannya berbentuk keong emas raksasa, diambil dari dongeng Keong Mas. Di dalamnya ada teater dengan layar IMAX yang memutar film-film bertema budaya dan alam Indonesia. Bentuk bangunannya sendiri sudah jadi salah satu penanda paling dikenal di TMII, jadi banyak pengunjung berhenti berfoto di plazanya dulu.",
    image: "assets/keong-mas.jpg",
    width: 1280,
    height: 720,
  },
  {
    name: "Istana Anak-Anak Indonesia",
    label: "Wahana",
    color: "kunyit",
    text: "Bangunan istana bergaya dongeng dengan area bermain dan kegiatan untuk anak.",
    detail:
      "Istana bergaya dongeng dengan menara dan warna cerah, dibangun sebagai tempat bermain dan belajar anak. Di dalamnya ada area permainan dan kegiatan untuk anak, dan halamannya sering dipakai rombongan sekolah untuk berkumpul. Area ini dikunjungi dengan tiket masuk gerbang, tidak ada tiket terpisah untuknya di katalog situs ini.",
    image: "assets/istana-anak.jpg",
    width: 960,
    height: 720,
  },
  {
    name: "Museum Indonesia",
    label: "Museum",
    color: "nila",
    text: "Museum etnografi bergaya Bali. Koleksinya pakaian adat, senjata tradisional, dan kerajinan dari berbagai daerah.",
    ticketId: "museum-indonesia",
    detail:
      "Museum etnografi di gedung bergaya Bali dengan gapura belah khasnya. Koleksinya merangkum budaya daerah-daerah di Indonesia: pakaian adat, senjata tradisional, alat musik, dan kerajinan. Cocok dikunjungi sebelum atau sesudah keliling anjungan, sebagai ringkasan sebelum melihat rumah adatnya satu per satu.",
    image: "assets/museum-indonesia.jpg",
    width: 1280,
    height: 720,
  },
  {
    name: "Anjungan Daerah",
    label: "Budaya",
    color: "bata",
    text: "Rumah adat dari provinsi-provinsi di Indonesia, masing-masing memajang pakaian, alat musik, dan kerajinan daerahnya.",
    ticketId: "anjungan",
    detail:
      "Anjungan adalah kompleks rumah adat dari provinsi-provinsi di Indonesia, masing-masing dibangun mengikuti bentuk aslinya, seperti Rumah Gadang dari Sumatera Barat dan Rumah Tongkonan dari Sulawesi Selatan. Di tiap anjungan dipajang pakaian adat, alat musik, dan kerajinan daerahnya, dan halamannya sering dipakai untuk pertunjukan budaya.",
    image: "assets/rumah-gadang.jpg",
    width: 960,
    height: 1280,
  },
  {
    name: "Taman Burung",
    label: "Alam",
    color: "daun",
    text: "Taman berkubah berisi burung-burung Indonesia, termasuk rangkong yang jadi salah satu penghuni khasnya.",
    detail:
      "Taman berkubah yang menampung burung-burung dari berbagai daerah di Indonesia. Pengunjung berjalan di dalam kubahnya sementara burung-burung terbang dan hinggap di sekitar jalur jalan. Salah satu penghuni khasnya rangkong, burung berparuh besar yang fotonya tampil di kartu taman ini. Area ini dikunjungi dengan tiket masuk gerbang, tidak ada tiket terpisah untuknya di katalog situs ini.",
    image: "assets/taman-burung.jpg",
    width: 1280,
    height: 720,
  },
];

export const FACILITIES = [
  {
    name: "Area parkir",
    text: "Tersedia untuk motor, mobil, dan bus rombongan sekolah.",
  },
  {
    name: "Toilet dan musala",
    text: "Ada di area anjungan dan titik utama kawasan.",
  },
  {
    name: "Tempat makan",
    text: "Restoran, kafe, dan pedagang makanan di dalam kawasan.",
  },
  {
    name: "Transportasi keliling",
    text: "Angkutan keliling listrik, kereta gantung, dan penyewaan sepeda.",
  },
  {
    name: "Pusat informasi",
    text: "Petugas informasi di dekat gerbang masuk.",
  },
  {
    name: "Area istirahat",
    text: "Taman dan bangku untuk duduk santai dan piknik keluarga.",
  },
];

export const PAYMENT_METHODS = [
  {
    id: "qris",
    name: "QRIS",
    text: "Satu kode untuk semua aplikasi pembayaran yang mendukung QRIS.",
  },
  {
    id: "ewallet",
    name: "Dompet digital",
    text: "Bayar dari saldo dompet digital yang kamu pakai.",
  },
  {
    id: "transfer",
    name: "Transfer bank",
    text: "Kode pembayaran dikirim setelah pesanan dibuat.",
  },
];

export function ticketById(id) {
  return TICKETS.find((ticket) => ticket.id === id);
}
