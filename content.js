// 현재 탭을 추가할 때, 페이지가 표시하는 주소와 제목을 팝업으로 돌려준다.
(() => ({
  url: window.location.href,
  title: document.title.trim(),
}))();
