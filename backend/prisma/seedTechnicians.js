// Import initial des installateurs (liste des invités externes Kraaft fournie
// par Julien le 09/10/2026). Exécuté au déploiement, après `prisma db push`.
// Idempotent: un technicien n'est créé que si aucune fiche du même prénom +
// nom n'existe déjà — une fiche corrigée ou désactivée depuis le CRM n'est
// donc jamais recréée ni réactivée. Ne bloque jamais le déploiement.
// Les ID Kraaft ont été relevés sur une capture d'écran: ils seront vérifiés
// (et corrigés au besoin) via l'API Kraaft lors de l'intégration.
const { PrismaClient } = require("@prisma/client");

const TECHNICIANS = [
  ["Boris", "Desportes", "+33656685412", "AL5I5ghIA8Xxhkm20kOHp3iG0k42"],
  ["Dimitry", "Demanou", "+33778242698", "3wU8C51iq7MXHYcEJDJSfZfnCnA2"],
  ["Dsb", "Energys", "+33767532843", "CsP2dnTCVrUCxlua2FGHNRSAbcC3"],
  ["Kevin", "Mouniman", null, "LOdYRoxzGteJXy1gH6S9IScpjM32"],
  ["Malek", "Aouina", "+33688727953", "oDmQb4nSBTV1y2babs6el3EHIBC2"],
  ["Morgan", "Salvador", "+33665968254", "zlBGbq0upKg8YuLnCu1ehIUxWTR2"],
  ["Omar", "Bencheikh", "+33646390663", "xvHLawVb7GVi7a3i25WAdPKa1lS2"],
  ["Sofiane", "Saghir", null, "4nlXa9spv0WLLlZTieA2JitzK392"],
  ["Soifaoui", "Dhoulcarnahine", "+33635314289", "kBPXQq3rSbeIUVp3o23E5sDFlLH2"],
  ["Xavier", "Szucsany", null, "gbjN5rTH59dO7moUaMsljCPGDA72"],
  ["Yass", "Elec", "+33780491322", "TUw53JG2FUQGzcA63JEISXnqHXE2"],
];

async function main() {
  if (!process.env.DATABASE_URL) return;
  const prisma = new PrismaClient();
  try {
    let created = 0;
    for (const [firstName, lastName, phone, kraaftUserId] of TECHNICIANS) {
      const exists = await prisma.technician.findFirst({
        where: {
          OR: [
            { kraaftUserId },
            { firstName: { equals: firstName, mode: "insensitive" }, lastName: { equals: lastName, mode: "insensitive" } },
          ],
        },
      });
      if (!exists) {
        await prisma.technician.create({ data: { firstName, lastName, phone, kraaftUserId } });
        created++;
      }
    }
    console.log(`[seedTechnicians] ${created} technicien(s) créé(s)`);
  } catch (err) {
    console.error("[seedTechnicians] ignoré:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
