export interface Product {
  id: string;
  title: string;
  subtitle: string;
  price: number;
  images: string[];
}

export const mockProducts: Product[] = [
  {
    id: "1",
    title: "Floral Summer Dress",
    subtitle: "Summer Collection",
    price: 49.99,
    images: ["/images/product_1.png", "/images/prod1_var1.png", "/images/prod1_var2.png"],
  },
  {
    id: "2",
    title: "Classic Denim Jeans",
    subtitle: "Premium Denim",
    price: 59.99,
    images: ["/images/product_2.png", "/images/prod2_var1.png", "/images/prod2_var2.png"],
  },
  {
    id: "3",
    title: "White Cotton Tee",
    subtitle: "Organic Cotton",
    price: 24.99,
    images: ["/images/product_3.png", "/images/prod3_var1.png", "/images/prod3_var2.png"],
  },
  {
    id: "4",
    title: "Leather Ankle Boots",
    subtitle: "Genuine Leather",
    price: 89.99,
    images: ["/images/product_4.png", "/images/prod4_var1.png", "/images/prod4_var2.png"],
  },
  {
    id: "5",
    title: "Red Cocktail Dress",
    subtitle: "Evening Glam",
    price: 129.00,
    images: ["/images/product_1.png", "/images/prod5_var1.png", "/images/prod5_var2.png"],
  },
  {
    id: "6",
    title: "Denim Shirt Dress",
    subtitle: "Casual Day",
    price: 55.99,
    images: ["/images/product_2.png", "/images/prod6_var1.png", "/images/prod6_var2.png"],
  },
  {
    id: "7",
    title: "Cropped Bomber",
    subtitle: "Street Style",
    price: 85.00,
    images: ["/images/bomber_jacket.png", "/images/prod7_var1.png", "/images/prod7_var2.png"],
  },
  {
    id: "8",
    title: "Classic High Tops",
    subtitle: "Kicks & Co.",
    price: 95.00,
    images: ["/images/hightop.png", "/images/prod8_var1.png", "/images/prod8_var2.png"],
  },
  {
    id: "9",
    title: "Plaid Button Up",
    subtitle: "Cozy Flannel",
    price: 45.00,
    images: ["/images/plaid_shirt.png", "/images/prod9_var1.png", "/images/prod9_var2.png"],
  },
  {
    id: "10",
    title: "Quarter-Zip Pullover",
    subtitle: "Active Wear",
    price: 60.00,
    images: ["/images/quarter-zip.png", "/images/prod10_var1.png", "/images/prod10_var2.png"],
  },
  {
    id: "11",
    title: "Flutter Hat",
    subtitle: "Headwear",
    price: 25.00,
    images: ["/images/flutter_hat.png", "/images/prod11_var1.png", "/images/prod11_var2.png"],
  },
  {
    id: "12",
    title: "Letterman Jacket",
    subtitle: "Varsity Style",
    price: 110.00,
    images: ["/images/flutter_letterman.png", "/images/prod12_var1.png", "/images/prod12_var2.png"],
  },
];
