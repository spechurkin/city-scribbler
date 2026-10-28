export function viewportPoint(view, rect, x, y) {
    const scale = Math.min(rect.width / view.width, rect.height / view.height);
    return [view.x + (x - rect.left - (rect.width - view.width * scale) / 2) / scale,
        view.y + (y - rect.top - (rect.height - view.height * scale) / 2) / scale];
}

export function rasterPlacement(base, view, width, height) {
    const scale = Math.min(width / view.width, height / view.height);
    return {
        x: (width - view.width * scale) / 2 + (base.x - view.x) * scale,
        y: (height - view.height * scale) / 2 + (base.y - view.y) * scale,
        width: base.width * scale, height: base.height * scale
    };
}

// Reuse a bounded bitmap during gestures; restore vectors before picking an object.
export function createMapViewport(container, afterFrame) {
    let svg, canvas, base, frame = 0, timer, revision = 0, pending, gesturing = false;
    const restore = () => {
        if (svg) {
            if (pending) {
                const box = pending.view;
                svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
            }
            svg.style.opacity = '';
            svg.style.visibility = '';
            svg.style.display = '';
        }
        if (canvas) canvas.hidden = true;
    };
    const paint = () => {
        frame = 0;
        if (!svg || !pending) return;
        const {view, preview} = pending;
        if (preview && canvas) {
            const width = container.clientWidth, height = container.clientHeight;
            const p = rasterPlacement(base, view, width, height);
            canvas.hidden = false;
            canvas.style.transform = `translate(${p.x}px, ${p.y}px) scale(${p.width / canvas.width}, ${p.height / canvas.height})`;
            // display:none also removes thousands of paths from pointer hit testing.
            svg.style.display = 'none';
        } else restore();
        afterFrame();
    };
    return {
        reset(box, enabled = true) {
            const current = ++revision;
            clearTimeout(timer);
            cancelAnimationFrame(frame);
            frame = 0;
            restore();
            canvas?.remove();
            canvas = null;
            pending = null;
            gesturing = false;
            svg = container.querySelector('svg');
            base = {...box};
            if (!enabled || !svg) return;
            const copy = svg.cloneNode(true);
            copy.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
            copy.style.opacity = '';
            copy.style.display = '';
            const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], {type: 'image/svg+xml'}));
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                if (current !== revision) return;
                const bitmap = document.createElement('canvas');
                const ratio = Math.min(2, devicePixelRatio || 1);
                bitmap.width = Math.min(3072, Math.max(1600, Math.ceil(container.clientWidth * ratio)));
                bitmap.height = Math.round(bitmap.width * box.height / box.width);
                const context = bitmap.getContext('2d');
                if (!context) return;
                context.drawImage(image, 0, 0, bitmap.width, bitmap.height);
                bitmap.className = 'map-navigation-bitmap';
                bitmap.setAttribute('aria-hidden', 'true');
                bitmap.hidden = true;
                canvas = bitmap;
                container.append(bitmap);
            };
            image.onerror = () => URL.revokeObjectURL(url);
            image.src = url;
        },
        sync(view, preview = true) {
            pending = {view: {...view}, preview};
            clearTimeout(timer);
            if (!frame) frame = requestAnimationFrame(paint);
            if (!gesturing) timer = setTimeout(restore, 160);
        },
        beginGesture() {
            gesturing = true;
            clearTimeout(timer);
        },
        endGesture() {
            gesturing = false;
            clearTimeout(timer);
            timer = setTimeout(restore, 160);
        },
        finish() {
            clearTimeout(timer);
            cancelAnimationFrame(frame);
            frame = 0;
            restore();
        }
    };
}
