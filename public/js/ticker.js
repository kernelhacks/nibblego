// Reloj en un worker: los temporizadores de pestañas ocultas se frenan, los del worker no tanto.
let id = 0;
onmessage = (e) => {
  clearInterval(id);
  id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : 0;
};
