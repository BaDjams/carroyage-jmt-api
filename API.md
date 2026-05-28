# carroyage-jmt-api — Documentation API

## Vue d'ensemble

Cette API génère des **grilles CADO** (Carroyage Adapté aux Découpages Opérationnels) pour la gestion opérationnelle de terrain. Elle produit :

- Des fichiers **KMZ** (Google Earth / applications SIGCC) contenant les lignes de grille et les points de cellule
- Des **images PNG/JPEG** avec fond cartographique (IGN, OSM) et grille superposée

La grille est un quadrillage rectangulaire dont les colonnes sont désignées par des lettres (A, B… Z, AA…) et les lignes par des chiffres. Chaque cellule est nommée par la combinaison colonne + ligne (ex. `B3`). La grille peut être tournée par rapport au nord géographique.

---

## Base URL

```
http://<host>:<port>
```

Par défaut `http://localhost:3000`. Toutes les routes API sont préfixées par `/api`.

## Authentification

Aucune. L'API est ouverte.

---

## Endpoints

| Méthode | Chemin | Description |
|---------|--------|-------------|
| `GET` | `/health` | Vérification de disponibilité |
| `GET` | `/api` | Liste des endpoints |
| `POST` | `/api/kmz/cado` | Générer un fichier KMZ |
| `POST` | `/api/kmz/cado/preview` | Pré-visualiser la grille (JSON, sans générer le fichier) |
| `POST` | `/api/image/cado` | Générer une image PNG/JPEG avec fond de carte |

---

## GET /health

Retourne `200 OK` si le serveur est opérationnel.

```json
{ "status": "ok" }
```

---

## Paramètres communs (corps JSON)

Les endpoints `POST /api/kmz/cado`, `POST /api/kmz/cado/preview` et `POST /api/image/cado` acceptent tous le même corps de base, décrit ci-dessous. L'endpoint image ajoute des paramètres supplémentaires (voir section dédiée).

### 1. Positionnement — deux modes mutuellement exclusifs

#### Mode coordonnée unique

Définit un point de référence unique autour duquel la grille est construite.

| Paramètre | Type | Obligatoire | Description |
|-----------|------|-------------|-------------|
| `latitude` | `number` | Oui (ce mode) | Latitude du point de référence en degrés décimaux (−90 à +90) |
| `longitude` | `number` | Oui (ce mode) | Longitude du point de référence en degrés décimaux (−180 à +180) |

Le rôle de ce point dépend de `referencePointChoice` (voir plus bas) : il peut être le **centre** de la grille ou le **coin A1** (origine).

#### Mode zone (deux points)

Définit un rectangle géographique ; la grille est calculée automatiquement pour couvrir la zone. `referencePointChoice` et `gridType` sont ignorés dans ce mode.

| Paramètre | Type | Obligatoire | Description |
|-----------|------|-------------|-------------|
| `zonePoint1` | `object` | Oui (ce mode) | Premier coin de la zone — `{ "latitude": number, "longitude": number }` |
| `zonePoint2` | `object` | Oui (ce mode) | Second coin opposé de la zone — `{ "latitude": number, "longitude": number }` |

L'API détermine automatiquement le coin NW et SE, calcule les distances réelles (Haversine) et dimensionne la grille pour couvrir entièrement le rectangle.

---

### 2. Taille des cellules

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `scale` | `number` | — **obligatoire** | Taille d'une cellule en mètres (1 à 100 000). Valeurs typiques : `250`, `500`, `1000`. |

---

### 3. Format de la grille

#### Prédéfinis (`gridType`)

| Valeur | Lignes | Colonnes | Cellules totales |
|--------|--------|----------|-----------------|
| `Q12` | 1 → 12 | A → Q | 204 |
| `Z18` | 1 → 18 | A → Z | 468 |
| `Z14` | 1 → 14 | A → Z | 364 |
| `Q9` | 1 → 9 | A → Q | 153 |
| `Z26` | 1 → 26 | A → Z | 676 |

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `gridType` | `enum` | `"Q12"` | Format de grille prédéfini. Ignoré en mode zone. |

#### Grille personnalisée (`gridType: "custom"`)

Si `gridType` vaut `"custom"`, les quatre paramètres suivants deviennent **obligatoires** :

| Paramètre | Type | Description |
|-----------|------|-------------|
| `startRow` | `integer` | Numéro de ligne de départ (ex. `1`) |
| `endRow` | `integer` | Numéro de ligne de fin (ex. `20`) |
| `startCol` | `string` | Lettre de colonne de départ (ex. `"A"`) |
| `endCol` | `string` | Lettre de colonne de fin (ex. `"T"`) |

---

### 4. Point de référence (mode coordonnée unique uniquement)

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `referencePointChoice` | `"center"` \| `"origin"` | `"center"` | `"center"` : les coordonnées sont le **centre** de la grille. `"origin"` : les coordonnées sont le **coin A1** (case en haut à gauche). |

---

### 5. Orientation et rotation

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `deviation` | `number` | `0` | Rotation de la grille en degrés par rapport au nord géographique (−360 à +360). Positif = sens horaire. |
| `letteringDirection` | `"ascending"` \| `"descending"` | `"ascending"` | `"ascending"` : les numéros de ligne croissent vers le bas (convention standard). `"descending"` : croissent vers le haut. |
| `swapAxes` | `boolean` | `false` | Échange les axes : les lettres deviennent les lignes et les chiffres les colonnes. Le nom des cellules devient `B3` → `3B`. |

---

### 6. Apparence

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `gridColor` | `string` | `"#FF0000"` | Couleur des lignes et labels au format hexadécimal CSS (`#RRGGBB`). |
| `colorName` | `string` | `"red"` | Nom lisible de la couleur. Utilisé dans le KMZ comme métadonnée et dans l'endpoint image pour choisir la couleur de contour des labels (couleurs sombres → contour blanc, autres → contour noir). |
| `colorOpacity` | `number` | `0.5` | Opacité des lignes de grille (0 = transparent, 1 = opaque). Les labels restent toujours opaques. |
| `labelSize` | `number` | `1` | Taille des labels de cellule dans le KMZ (0 à 10). `0` = masqués. |
| `iconSize` | `number` | `2` | Taille des icônes de point dans le KMZ (0 à 10). `0` = masqués. |

---

### 7. Contenu

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `contentType` | `enum` | `"grid-points"` | Ce que le KMZ/image contient : `"grid-only"` (lignes uniquement), `"points-only"` (points de cellule uniquement), `"grid-points"` (les deux). |
| `doubleEntry` | `boolean` | `false` | Ajoute des labels en bordure extérieure de grille (double entrée : les identifiants de colonnes et lignes apparaissent aussi sur le pourtour). |

---

### 8. Nommage

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `gridName` | `string` | `"CADO Grid"` | Nom de la grille (1 à 200 caractères). Utilisé comme nom de calque dans le KMZ et nom de fichier par défaut. |
| `gridNameBase` | `string` | *(valeur de gridName)* | Nom de base pour la numérotation des cellules si différent du nom d'affichage. |
| `fileName` | `string` | *(auto)* | Nom du fichier retourné (sans extension). Caractères autorisés : `\w`, `-`, `.`, espace. Si absent, `gridName` est utilisé. |

---

## POST /api/kmz/cado

Génère et retourne un fichier KMZ.

### Requête

```http
POST /api/kmz/cado
Content-Type: application/json
```

Corps : paramètres communs décrits ci-dessus.

### Réponse (succès — 200)

Le corps est le fichier KMZ binaire (ZIP contenant un KML + icônes PNG).

| En-tête | Valeur | Description |
|---------|--------|-------------|
| `Content-Type` | `application/vnd.google-earth.kmz` | |
| `Content-Disposition` | `attachment; filename="<nom>.kmz"` | Nom du fichier suggéré |
| `X-Grid-Cells` | `"204"` | Nombre de cellules dans la grille |
| `X-Grid-Origin` | `"6.8302,45.7881"` | Coordonnées `[lon, lat]` du coin A1 |

### Exemple — grille unique

```bash
curl -X POST http://localhost:3000/api/kmz/cado \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 45.7997,
    "longitude": 6.8534,
    "scale": 1000,
    "gridType": "Q12",
    "gridName": "Secteur Chamonix",
    "gridColor": "#0000FF",
    "colorOpacity": 0.6,
    "deviation": 15,
    "referencePointChoice": "center"
  }' \
  --output chamonix.kmz
```

### Exemple — zone entre deux points

```bash
curl -X POST http://localhost:3000/api/kmz/cado \
  -H "Content-Type: application/json" \
  -d '{
    "zonePoint1": { "latitude": 45.82, "longitude": 6.82 },
    "zonePoint2": { "latitude": 45.77, "longitude": 6.90 },
    "scale": 500,
    "gridName": "Zone Opérationnelle Nord"
  }' \
  --output zone.kmz
```

---

## POST /api/kmz/cado/preview

Calcule la grille et retourne ses métadonnées en JSON **sans générer de fichier**. Utile pour valider les paramètres avant génération.

### Requête

Identique à `POST /api/kmz/cado`.

### Réponse (succès — 200)

```json
{
  "config": {
    "latitude": 45.7997,
    "longitude": 6.8534,
    "scale": 1000,
    "startRow": 1,
    "endRow": 12,
    "startCol": "A",
    "endCol": "Q",
    ...
  },
  "stats": {
    "rows": 12,
    "cells": 204,
    "origin": [6.7662, 45.7457],
    "referenceCenter": [6.8534, 45.7997]
  }
}
```

En mode zone, `stats` contient en plus :

```json
{
  "zoneMode": true,
  "zonePoint1": { "latitude": 45.82, "longitude": 6.82 },
  "zonePoint2": { "latitude": 45.77, "longitude": 6.90 },
  "gridDimensions": { "columns": "N", "rows": 11 }
}
```

---

## POST /api/image/cado

Génère une image PNG ou JPEG avec fond cartographique téléchargé depuis un fournisseur de tuiles, et la grille CADO superposée.

### Paramètres supplémentaires (en plus des paramètres communs)

| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `tileProvider` | `enum` | `"ign_ortho"` | Source des tuiles de fond. Voir tableau ci-dessous. |
| `imageFormat` | `"png"` \| `"jpeg"` | `"png"` | Format de l'image retournée. |
| `jpegQuality` | `number` | `0.9` | Qualité JPEG (0 à 1). Ignoré si `imageFormat` est `"png"`. |
| `lineWidth` | `number` | `1` | Épaisseur des lignes de grille en pixels (> 0, max 20). |
| `upscale` | `boolean` | `true` | Si `true`, l'image est agrandie pour atteindre ~2160 px de hauteur (max 16×). Désactiver pour obtenir la résolution native des tuiles. |

#### Fournisseurs de tuiles

| Valeur | Description | Couches |
|--------|-------------|---------|
| `ign_ortho` | IGN Orthophotographie (photo aérienne) + réseau routier + toponymie | 3 couches WMTS |
| `ign_plan` | IGN Plan v2 (carte topographique) | 1 couche WMTS |
| `osm` | OpenStreetMap standard | 1 couche XYZ |
| `none` | Fond blanc (sans téléchargement réseau) | — |

Tous les fournisseurs sont **publics et sans clé API**. IGN nécessite un accès au réseau `data.geopf.fr`.

### Requête

```http
POST /api/image/cado
Content-Type: application/json
```

### Réponse (succès — 200)

Le corps est l'image binaire (PNG ou JPEG).

| En-tête | Valeur |
|---------|--------|
| `Content-Type` | `image/png` ou `image/jpeg` |
| `Content-Disposition` | `attachment; filename="<nom>.png"` |
| `X-Grid-Origin` | JSON décrivant le centre ou le mode zone |

### Exemple

```bash
curl -X POST http://localhost:3000/api/image/cado \
  -H "Content-Type: application/json" \
  -d '{
    "zonePoint1": { "latitude": 45.82, "longitude": 6.82 },
    "zonePoint2": { "latitude": 45.77, "longitude": 6.90 },
    "scale": 500,
    "gridName": "Zone Nord",
    "gridColor": "#FF0000",
    "tileProvider": "ign_ortho",
    "imageFormat": "jpeg",
    "jpegQuality": 0.85,
    "lineWidth": 2,
    "upscale": true
  }' \
  --output zone_nord.jpg
```

---

## Erreurs

Toutes les erreurs suivent le format :

```json
{
  "error": "ValidationError",
  "issues": [
    {
      "code": "invalid_type",
      "path": ["latitude"],
      "message": "Either latitude+longitude or zonePoint1+zonePoint2 must be provided"
    }
  ]
}
```

| Code HTTP | `error` | Cause |
|-----------|---------|-------|
| `400` | `ValidationError` | Paramètre manquant, hors limites, ou combinaison invalide |
| `404` | `NotFound` | Route inexistante |
| `500` | `InternalServerError` | Erreur serveur (ex. trop de tuiles, timeout réseau) |

### Erreurs fréquentes

| Situation | Message |
|-----------|---------|
| Ni coordonnée unique ni zone fournie | `Either latitude+longitude or zonePoint1+zonePoint2 must be provided` |
| `gridType: "custom"` sans bornes | `Custom gridType requires startRow, endRow, startCol, endCol` |
| Zone trop grande (> 800 tuiles) | `Too many tiles requested (N). Reduce the zone size or increase the scale.` |

---

## Notes techniques

- **Projection** : Mercator Web (EPSG:3857) pour les tuiles. Les calculs de grille utilisent une approximation sphérique locale (équateur de référence à `config.latitude`).
- **Distances** : calculées avec la formule Haversine (rayon terrestre R = 6 371 km), identiques à la version navigateur Carroyage-JMT.
- **Limites de tuiles** : le serveur rejette les requêtes image nécessitant plus de 800 tuiles (toutes couches confondues). Augmenter `scale` ou réduire la zone si cette erreur survient.
- **Concurrence** : les tuiles sont téléchargées en parallèle (8 requêtes simultanées maximum) avec un timeout de 10 s par tuile.
- **Canvas** : rendu serveur via `@napi-rs/canvas` (bindings Node natifs à Skia).
