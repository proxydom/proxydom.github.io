let canvas;
let context;
let timerId;
let frame = 0;

self.addEventListener('message', event => {
    if (event.data.type !== 'start') return;

    canvas = new OffscreenCanvas(32, 32);
    context = canvas.getContext('2d');
    render();
    if (!event.data.animate) return;

    timerId = setInterval(() => {
        frame += 1;
        render();
    }, 180);
});

async function render() {
    const pulse = 0.76 + (Math.sin(frame * 0.32) + 1) * 0.12;

    context.clearRect(0, 0, 32, 32);
    context.fillStyle = '#070707';
    context.fillRect(0, 0, 32, 32);

    context.globalAlpha = pulse;
    context.fillStyle = '#a71d25';
    context.fillRect(14, 4, 4, 24);
    context.fillRect(8, 11, 16, 4);

    context.globalAlpha = 1;
    context.strokeStyle = '#d4d0c6';
    context.lineWidth = 1;
    context.strokeRect(1.5, 1.5, 29, 29);

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const reader = new FileReader();
    reader.addEventListener('loadend', () => {
        self.postMessage({ type: 'frame', dataUrl: reader.result });
    });
    reader.readAsDataURL(blob);
}
