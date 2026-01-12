
createDistantCityLayers() {
    // Create a backdrop of simple geometry to fill the horizon void

    // Layer 1: Dense silhouettes just behind the fog start (z: -3000 to -4000)
    // Layer 2: Sparse tall towers in the far back (z: -4000 to -6000)

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x050010 }); // Very dark purple silhouette

    // Emissive windows for distant detail
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x220044 });

    const count = 300;
    const mesh = new THREE.InstancedMesh(geometry, material, count);

    const dummy = new THREE.Object3D();
    let idx = 0;

    for (let i = 0; i < count; i++) {
        // WIDER distribution to fill side gaps
        const x = (Math.random() - 0.5) * 3000;

        // Deep distance
        const z = -3500 - Math.random() * 2000;

        const w = 100 + Math.random() * 300;
        const h = 500 + Math.random() * 1500; // Tall
        const d = 100 + Math.random() * 300;

        // Avoid the very center where the Mega Tower sits (x: -100 to 100)
        if (Math.abs(x) < 250) continue;

        dummy.position.set(x, h / 2, z);
        dummy.scale.set(w, h, d);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);

    // Add a few "hero" distant lights (simple sprites)
    this.createDistantLights();
}

createDistantLights() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const colors = [];

    for (let i = 0; i < 200; i++) {
        const x = (Math.random() - 0.5) * 3000;
        if (Math.abs(x) < 200) continue; // Skip center

        const y = Math.random() * 1500;
        const z = -3500 - Math.random() * 2000;

        positions.push(x, y, z);

        const color = new THREE.Color();
        color.setHSL(Math.random(), 0.8, 0.5);
        colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 40,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.6,
        transparent: true
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
}
