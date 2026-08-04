const { PrismaClient } = require("@prisma/client");

// Instance unique de Prisma partagée par toute l'app
const prisma = new PrismaClient();

module.exports = prisma;
