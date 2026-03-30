async function beforeBuild() {
    return process.env.SERENITY_SKIP_ELECTRON_NODE_MODULE_SCAN !== '1';
}

module.exports = beforeBuild;
module.exports.beforeBuild = beforeBuild;
